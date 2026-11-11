use crate::{
    data::{self, DataUri},
    doc::{Doc, Edit},
    html::Element,
    ImageEncoding, ImageFormat, Transform,
};
use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use gamut_core::{Dimensions, EncodeImage, ImageRef, Rgb8, Rgba8};
use gamut_webp::WebpEncoder;
use image::RgbaImage;
use imgref::Img;
use oxipng::{Options as PngOptions, StripChunks};
use ravif::Encoder;
use rayon::prelude::*;
use rgb::FromSlice;
use std::io::Cursor;

const MAX_LOSSLESS_PIXELS: u64 = 40_000_000;
const MAX_LOSSY_PIXELS: u64 = 200_000_000;
const THOROUGH_PIXELS: u64 = 2_000_000;
const HEAVY_PIXELS: u64 = 8_000_000;

struct Decoded {
    image: DataUri,
    pixels: u64,
}

pub fn stage(doc: &Doc, lossy: Option<ImageEncoding>) -> Vec<Edit> {
    let tags: Vec<_> = doc
        .tags
        .iter()
        .filter(|t| t.element == Element::Img && !t.in_svg)
        .collect();
    let uris: Vec<(usize, &str, &str)> = tags
        .iter()
        .enumerate()
        .flat_map(|(at, tag)| {
            tag.attrs
                .iter()
                .filter(|(name, _)| matches!(name.as_str(), "src" | "data-src"))
                .map(move |(name, uri)| (at, name.as_str(), uri.as_str()))
        })
        .collect();
    let mut starts = vec![0; tags.len() + 1];
    for (owner, _, _) in &uris {
        starts[owner + 1] += 1;
    }
    for at in 0..tags.len() {
        starts[at + 1] += starts[at];
    }
    let decoded: Vec<Option<Decoded>> = uris.par_iter().map(|(_, _, uri)| decode(uri)).collect();
    let (heavy, light): (Vec<usize>, Vec<usize>) = (0..uris.len())
        .partition(|&i| decoded[i].as_ref().is_some_and(|d| d.pixels > HEAVY_PIXELS));
    let convert = |i: usize| (i, decoded[i].as_ref().and_then(|d| reencode(d, lossy)));
    let (light_done, heavy_done): (Vec<_>, Vec<_>) = rayon::join(
        || light.par_iter().map(|&i| convert(i)).collect(),
        || heavy.iter().map(|&i| convert(i)).collect(),
    );
    let mut converted: Vec<Option<String>> = vec![None; uris.len()];
    for (i, uri) in light_done.into_iter().chain(heavy_done) {
        converted[i] = uri;
    }
    tags.iter()
        .enumerate()
        .map(|(at, tag)| Edit {
            span: tag.span.clone(),
            text: tag.open_tag(|name, value| {
                let source = uris[starts[at]..starts[at + 1]]
                    .iter()
                    .position(|(_, attr, _)| *attr == name)
                    .map(|offset| starts[at] + offset);
                let replacement = source.and_then(|i| converted[i].take());
                Some(replacement.unwrap_or_else(|| value.to_string()))
            }),
            transform: if lossy.is_some() {
                Transform::ReencodedImage
            } else {
                Transform::RecompressedPng
            },
            target: tag.attr("id").unwrap_or("img").to_string(),
        })
        .filter(Edit::shrinks)
        .collect()
}

fn decode(uri: &str) -> Option<Decoded> {
    let image =
        data::decode(uri).filter(|d| matches!(d.mime.as_str(), "image/png" | "image/jpeg"))?;
    let (width, height) = image::ImageReader::new(Cursor::new(&image.bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    Some(Decoded {
        image,
        pixels: u64::from(width) * u64::from(height),
    })
}

fn reencode(decoded: &Decoded, lossy: Option<ImageEncoding>) -> Option<String> {
    lossy
        .and_then(|encoding| encode(decoded, encoding))
        .or_else(|| recompress(decoded))
}

fn recompress(decoded: &Decoded) -> Option<String> {
    if decoded.image.mime != "image/png" || decoded.pixels > MAX_LOSSLESS_PIXELS {
        return None;
    }
    let preset = if decoded.pixels <= THOROUGH_PIXELS {
        4
    } else if decoded.pixels <= HEAVY_PIXELS {
        2
    } else {
        1
    };
    let options = PngOptions {
        strip: StripChunks::Safe,
        ..PngOptions::from_preset(preset)
    };
    let smaller = oxipng::optimize_from_memory(&decoded.image.bytes, &options)
        .ok()
        .filter(|better| better.len() < decoded.image.bytes.len())?;
    Some(data::encode_base64("image/png", &smaller))
}

fn encode(decoded: &Decoded, lossy: ImageEncoding) -> Option<String> {
    if decoded.pixels > MAX_LOSSY_PIXELS {
        return None;
    }
    let mut image = image::load_from_memory(&decoded.image.bytes)
        .ok()?
        .into_rgba8();
    let mut resized = false;
    if let Some(side) = lossy
        .max_side
        .filter(|&side| image.width().max(image.height()) > side)
    {
        image = shrink(image, side)?;
        resized = true;
    }
    let pixels = u64::from(image.width()) * u64::from(image.height());
    let (mime, bytes) = match lossy.format {
        ImageFormat::Avif => ("image/avif", avif(&image, lossy.quality, pixels)?),
        ImageFormat::Webp => ("image/webp", webp(&image, lossy.quality)?),
    };
    (resized || bytes.len() * 10 < decoded.image.bytes.len() * 9)
        .then(|| data::encode_base64(mime, &bytes))
}

fn shrink(image: RgbaImage, side: u32) -> Option<RgbaImage> {
    let (source_width, source_height) = (image.width(), image.height());
    let scale = f64::from(side) / f64::from(source_width.max(source_height));
    let width = ((f64::from(source_width) * scale).round() as u32).max(1);
    let height = ((f64::from(source_height) * scale).round() as u32).max(1);
    let source = Image::from_vec_u8(
        source_width,
        source_height,
        image.into_raw(),
        PixelType::U8x4,
    )
    .ok()?;
    let mut resized = Image::new(width, height, PixelType::U8x4);
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::CatmullRom));
    Resizer::new()
        .resize(&source, &mut resized, &options)
        .ok()?;
    RgbaImage::from_raw(width, height, resized.into_vec())
}

fn avif(image: &RgbaImage, quality: u8, pixels: u64) -> Option<Vec<u8>> {
    let speed = if pixels > HEAVY_PIXELS { 10 } else { 8 };
    let pixels = Img::new(
        image.as_raw().as_rgba(),
        image.width() as usize,
        image.height() as usize,
    );
    let encoded = Encoder::new()
        .with_quality(f32::from(quality))
        .with_speed(speed)
        .encode_rgba(pixels)
        .ok()?;
    Some(encoded.avif_file)
}

fn webp(image: &RgbaImage, quality: u8) -> Option<Vec<u8>> {
    let dims = Dimensions::new(image.width(), image.height()).ok()?;
    let encoder = WebpEncoder::lossy(quality);
    let mut encoded = Vec::new();
    if image.pixels().all(|p| p.0[3] == 255) {
        let rgb: Vec<u8> = image
            .pixels()
            .flat_map(|p| [p.0[0], p.0[1], p.0[2]])
            .collect();
        encoder
            .encode_image(ImageRef::<Rgb8>::new(&rgb, dims).ok()?, &mut encoded)
            .ok()?;
    } else {
        encoder
            .encode_image(
                ImageRef::<Rgba8>::new(image.as_raw(), dims).ok()?,
                &mut encoded,
            )
            .ok()?;
    }
    Some(encoded)
}
