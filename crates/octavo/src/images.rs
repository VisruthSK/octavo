use crate::{
    data::{self, DataUri},
    doc::{Doc, Edit},
    ImageEncoding, ImageFormat,
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
use std::{io::Cursor, sync::Mutex};

const MAX_LOSSLESS_PIXELS: u64 = 40_000_000;
const MAX_LOSSY_PIXELS: u64 = 200_000_000;
const THOROUGH_PIXELS: u64 = 2_000_000;
const HEAVY_PIXELS: u64 = 8_000_000;

static HEAVY: Mutex<()> = Mutex::new(());

pub fn stage(doc: &Doc, lossy: Option<ImageEncoding>) -> Vec<Edit> {
    let convert = |uri: &str| {
        lossy
            .and_then(|encoding| encode(uri, encoding))
            .or_else(|| recompress(uri))
            .unwrap_or_else(|| uri.to_string())
    };
    doc.tags
        .par_iter()
        .filter(|t| t.name == "img" && !t.in_svg)
        .map(|tag| Edit {
            span: tag.span.clone(),
            text: tag.open_tag(|name, value| {
                Some(if matches!(name, "src" | "data-src") {
                    convert(value)
                } else {
                    value.to_string()
                })
            }),
            transform: if lossy.is_some() {
                "images-lossy"
            } else {
                "png-lossless"
            },
            target: tag.attr("id").unwrap_or("img").to_string(),
        })
        .filter(Edit::shrinks)
        .collect()
}

fn embedded(uri: &str, mimes: &[&str], max_pixels: u64) -> Option<(DataUri, u64)> {
    let source = data::decode(uri).filter(|d| mimes.contains(&d.mime.as_str()))?;
    let (width, height) = image::ImageReader::new(Cursor::new(&source.bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    let pixels = u64::from(width) * u64::from(height);
    (pixels <= max_pixels).then_some((source, pixels))
}

fn recompress(uri: &str) -> Option<String> {
    let (source, pixels) = embedded(uri, &["image/png"], MAX_LOSSLESS_PIXELS)?;
    let preset = if pixels <= THOROUGH_PIXELS { 4 } else { 2 };
    let options = PngOptions {
        strip: StripChunks::Safe,
        ..PngOptions::from_preset(preset)
    };
    let smaller = oxipng::optimize_from_memory(&source.bytes, &options)
        .ok()
        .filter(|better| better.len() < source.bytes.len())?;
    Some(data::encode_base64("image/png", &smaller))
}

fn encode(uri: &str, lossy: ImageEncoding) -> Option<String> {
    let (source, pixels) = embedded(uri, &["image/png", "image/jpeg"], MAX_LOSSY_PIXELS)?;
    let _one_at_a_time = (pixels > HEAVY_PIXELS).then(|| HEAVY.lock());
    let mut image = image::load_from_memory(&source.bytes).ok()?.into_rgba8();
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
    (resized || bytes.len() * 10 < source.bytes.len() * 9)
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
