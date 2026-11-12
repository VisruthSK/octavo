use crate::{
    ImageEncoding, ImageFormat, Target, Transform, Tuning,
    data::{self, Mime},
    doc::{Doc, Edit},
    html::{AttrName, Element, Tag},
};
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer, images::Image};
use gamut_core::{Dimensions, EncodeImage, ImageRef, Rgb8, Rgba8};
use gamut_webp::WebpEncoder;
use image::RgbaImage;
use imgref::Img;
use oxipng::{Options as PngOptions, StripChunks};
use ravif::Encoder;
use rayon::prelude::*;
use rgb::FromSlice;
use std::{cmp::Reverse, collections::HashMap, io::Cursor, num::NonZeroU32};

const RENDERING_CHUNKS: [[u8; 4]; 10] = [
    *b"cICP", *b"iCCP", *b"sRGB", *b"gAMA", *b"cHRM", *b"pHYs", *b"eXIf", *b"acTL", *b"fcTL",
    *b"fdAT",
];

// Preset 0 costs about 40 ns per pixel, so this keeps one image under about 1.6 s.
const MAX_LOSSLESS_PIXELS: u64 = 40_000_000;
const MAX_LOSSY_PIXELS: u64 = 200_000_000;
// The slowest measured cost of oxipng 10 presets 0 to 4 on 14 PNGs from real decks
// of 0.2 to 8 million pixels, single-threaded. Content moves the cost by about 2x.
const PRESET_NANOSECONDS_PER_PIXEL: [u64; 5] = [50, 101, 215, 335, 540];
// At 500 ms per image the output is 0.8 percent smaller but the run takes 30 percent longer.
const PRESET_TIME_BUDGET_NANOSECONDS: u64 = 75_000_000;
const LARGE_IMAGE_PIXELS: u64 = 8_000_000;

struct Decoded {
    image: data::DataUri,
    pixels: u64,
}

struct EncodedUri<'a> {
    attr: AttrName,
    value: &'a str,
    converted: Option<String>,
}

struct Candidate<'a> {
    tag: &'a Tag,
    uris: Vec<EncodedUri<'a>>,
}

fn preset_for(pixels: u64) -> u8 {
    (0..PRESET_NANOSECONDS_PER_PIXEL.len())
        .rev()
        .find(|&preset| {
            pixels * PRESET_NANOSECONDS_PER_PIXEL[preset] <= PRESET_TIME_BUDGET_NANOSECONDS
        })
        .unwrap_or(0) as u8
}

fn jobs_mut<'i, 'a>(images: &'i mut [Candidate<'a>]) -> Vec<&'i mut EncodedUri<'a>> {
    images
        .iter_mut()
        .flat_map(|image| image.uris.iter_mut())
        .collect()
}

pub(crate) fn stage(doc: &Doc, lossy: Option<ImageEncoding>, tuning: Tuning) -> Vec<Edit> {
    let mut images: Vec<Candidate> = doc
        .tags()
        .iter()
        .filter(|t| t.element == Element::Img && !t.in_svg)
        .map(|tag| Candidate {
            tag,
            uris: tag
                .attrs
                .iter()
                .filter(|attr| matches!(attr.name, AttrName::Src | AttrName::DataSrc))
                .map(|attr| EncodedUri {
                    attr: attr.name.clone(),
                    value: &attr.value,
                    converted: None,
                })
                .collect(),
        })
        .collect();
    let mut slot_of: HashMap<&str, usize> = HashMap::new();
    let mut distinct: Vec<&str> = Vec::new();
    let slots: Vec<usize> = images
        .iter()
        .flat_map(|image| image.uris.iter())
        .map(|uri| uri.value)
        .map(|value| {
            *slot_of.entry(value).or_insert_with(|| {
                distinct.push(value);
                distinct.len() - 1
            })
        })
        .collect();
    let decoded: Vec<Option<Decoded>> = distinct.par_iter().map(|value| decode(value)).collect();
    let mut largest_first: Vec<(usize, u64)> = decoded
        .iter()
        .enumerate()
        .filter_map(|(at, image)| image.as_ref().map(|image| (at, image.pixels)))
        .collect();
    largest_first.sort_by_key(|&(_, pixels)| Reverse(pixels));
    let mut converted: Vec<Option<String>> = vec![None; distinct.len()];
    let finished: Vec<(usize, String)> = largest_first
        .into_par_iter()
        .with_max_len(1)
        .filter_map(|(at, _)| {
            let uri = reencode(decoded[at].as_ref()?, lossy, tuning)?;
            Some((at, uri))
        })
        .collect();
    for (at, uri) in finished {
        converted[at] = Some(uri);
    }
    for (uri, &slot) in jobs_mut(&mut images).into_iter().zip(&slots) {
        uri.converted = converted[slot].clone();
    }
    images
        .into_iter()
        .map(|image| {
            let Candidate { tag, mut uris } = image;
            Edit {
                span: tag.span.clone(),
                text: tag.open_tag(|name, value| {
                    uris.iter_mut()
                        .find(|uri| uri.attr == *name)
                        .and_then(|uri| uri.converted.take())
                        .or_else(|| Some(value.to_string()))
                }),
                transform: if lossy.is_some() {
                    Transform::ReencodedImage
                } else {
                    Transform::RecompressedPng
                },
                target: Target::Resource(tag.label().to_string()),
            }
        })
        .filter(Edit::shrinks)
        .collect()
}

fn decode(uri: &str) -> Option<Decoded> {
    let image = data::decode(uri).filter(|d| matches!(d.mime, Mime::ImagePng | Mime::ImageJpeg))?;
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

fn reencode(decoded: &Decoded, lossy: Option<ImageEncoding>, tuning: Tuning) -> Option<String> {
    lossy
        .and_then(|encoding| encode(decoded, encoding))
        .or_else(|| recompress(decoded, tuning))
}

fn recompress(decoded: &Decoded, tuning: Tuning) -> Option<String> {
    if decoded.image.mime != Mime::ImagePng || decoded.pixels > MAX_LOSSLESS_PIXELS {
        return None;
    }
    let options = PngOptions {
        strip: StripChunks::Keep(RENDERING_CHUNKS.into_iter().collect()),
        ..PngOptions::from_preset(
            tuning
                .png_preset
                .map_or(preset_for(decoded.pixels), |preset| preset.min(6)),
        )
    };
    let smaller = oxipng::optimize_from_memory(&decoded.image.bytes, &options)
        .ok()
        .filter(|better| better.len() < decoded.image.bytes.len())?;
    Some(data::encode_base64(Mime::ImagePng, &smaller))
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
        .filter(|&side| image.width().max(image.height()) > side.get())
    {
        image = shrink(image, side)?;
        resized = true;
    }
    let pixels = u64::from(image.width()) * u64::from(image.height());
    let (mime, bytes) = match lossy.format {
        ImageFormat::Avif => (Mime::ImageAvif, avif(&image, lossy.quality.get(), pixels)?),
        ImageFormat::Webp => (Mime::ImageWebp, webp(&image, lossy.quality.get())?),
    };
    (resized || bytes.len() * 10 < decoded.image.bytes.len() * 9)
        .then(|| data::encode_base64(mime, &bytes))
}

fn shrink(image: RgbaImage, side: NonZeroU32) -> Option<RgbaImage> {
    let side = f64::from(side.get());
    let (source_width, source_height) = (image.width(), image.height());
    let scale = side / f64::from(source_width.max(source_height));
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
    let speed = if pixels > LARGE_IMAGE_PIXELS { 10 } else { 8 };
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
