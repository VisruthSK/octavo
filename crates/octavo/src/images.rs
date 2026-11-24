use crate::{
    ImageEncoding, ImageFormat, Rule, Target, Transform, Tuning,
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
use std::{
    cmp::Reverse,
    collections::HashMap,
    io::Cursor,
    num::NonZeroU32,
    sync::{Condvar, Mutex},
};

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
// AVIF speed 10 encodes about 65 percent faster than speed 8, but made three of five
// sample images 44 to 62 percent larger, so it is kept for the largest images only.
const LARGE_IMAGE_PIXELS: u64 = 8_000_000;
// A whole process encoding one 81 megapixel RGB PNG peaked at 15.4 bytes per pixel: the decoded
// image, libwebp's own ARGB copy and its encoder state. RGBA input adds a byte per pixel on top,
// and images are encoded in parallel, so they share a budget.
const WEBP_BYTES_PER_PIXEL: u64 = 20;
// Method 2 at quality 50 gave the best size for its time on 3 to 81 megapixel graphics, at about
// 65 ns per pixel. Method 1 at quality 20 takes half as long for a result 10 points larger.
const WEBP_THOROUGH_PIXELS: u64 = 20_000_000;

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

pub(crate) fn stage(
    doc: &Doc,
    lossy: Option<ImageEncoding>,
    tuning: Tuning,
    webp_memory: Option<u64>,
    normalize: bool,
) -> Vec<Edit> {
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
    let budget = webp_memory.map(MemoryBudget::new);
    let mut converted: Vec<Option<String>> = vec![None; distinct.len()];
    let finished: Vec<(usize, String)> = largest_first
        .into_par_iter()
        .with_max_len(1)
        .filter_map(|(at, _)| {
            let uri = reencode(decoded[at].as_ref()?, lossy, tuning, budget.as_ref())?;
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
            let recompressed = uris.iter().any(|uri| uri.converted.is_some());
            Edit {
                span: tag.span.clone(),
                text: tag.open_tag(|name, value| {
                    uris.iter_mut()
                        .find(|uri| uri.attr == *name)
                        .and_then(|uri| uri.converted.take())
                        .map(Some)
                        .unwrap_or_else(|| {
                            if normalize {
                                data::normalize(value)
                            } else {
                                None
                            }
                            .or_else(|| Some(value.to_string()))
                        })
                }),
                transform: if lossy.is_some() {
                    Transform::ReencodedImage
                } else if recompressed {
                    Transform::RecompressedPng
                } else {
                    Transform::NormalizedDataUrl
                },
                target: Target::Resource(tag.label().to_string()),
                rule: if lossy.is_some() {
                    Rule::ImageReencoded
                } else {
                    Rule::PngRecompressed
                },
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

fn reencode(
    decoded: &Decoded,
    lossy: Option<ImageEncoding>,
    tuning: Tuning,
    webp: Option<&MemoryBudget>,
) -> Option<String> {
    lossy
        .and_then(|encoding| encode(decoded, encoding))
        .or_else(|| recompress(decoded, tuning, webp))
}

fn recompress(decoded: &Decoded, tuning: Tuning, webp: Option<&MemoryBudget>) -> Option<String> {
    if decoded.image.mime != Mime::ImagePng {
        return None;
    }
    let png = recompress_png(&decoded.image.bytes, decoded.pixels, tuning);
    let kept = png.as_ref().map_or(decoded.image.bytes.len(), Vec::len);
    let converted = webp
        .and_then(|budget| lossless_webp(decoded, budget))
        .filter(|bytes| bytes.len() < kept);
    match converted {
        Some(bytes) => Some(data::encode_base64(Mime::ImageWebp, &bytes)),
        None => png.map(|bytes| data::encode_base64(Mime::ImagePng, &bytes)),
    }
}

struct MemoryBudget {
    total: u64,
    free: Mutex<u64>,
    freed: Condvar,
}

struct Held<'a> {
    budget: &'a MemoryBudget,
    amount: u64,
}

impl MemoryBudget {
    fn new(total: u64) -> MemoryBudget {
        MemoryBudget {
            total,
            free: Mutex::new(total),
            freed: Condvar::new(),
        }
    }

    fn take(&self, amount: u64) -> Option<Held<'_>> {
        if amount > self.total {
            return None;
        }
        let mut free = self.free.lock().ok()?;
        while *free < amount {
            free = self.freed.wait(free).ok()?;
        }
        *free -= amount;
        Some(Held {
            budget: self,
            amount,
        })
    }
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        if let Ok(mut free) = self.budget.free.lock() {
            *free += self.amount;
        }
        self.budget.freed.notify_all();
    }
}

fn png_converts_exactly(png: &[u8]) -> bool {
    let Some(mut rest) = png.strip_prefix(b"\x89PNG\r\n\x1a\n".as_slice()) else {
        return false;
    };
    let mut seen_header = false;
    while rest.len() >= 12 {
        let Ok(length) = <[u8; 4]>::try_from(&rest[..4]).map(u32::from_be_bytes) else {
            return false;
        };
        let length = length as usize;
        let kind = &rest[4..8];
        let Some(chunk) = rest.get(8..8 + length) else {
            return false;
        };
        if !seen_header {
            if kind != b"IHDR" || chunk.len() < 13 || chunk[8] == 16 {
                return false;
            }
            seen_header = true;
        } else if matches!(
            kind,
            b"cICP" | b"iCCP" | b"gAMA" | b"cHRM" | b"eXIf" | b"acTL"
        ) {
            return false;
        }
        let Some(next) = rest.get(12 + length..) else {
            return false;
        };
        rest = next;
    }
    seen_header
}

fn dynamic_has_partial_alpha(image: &image::DynamicImage) -> bool {
    let partial = |alpha: &u8| *alpha != 0 && *alpha != 255;
    match image {
        image::DynamicImage::ImageRgba8(rgba) => {
            rgba.as_raw().iter().skip(3).step_by(4).any(partial)
        }
        image::DynamicImage::ImageLumaA8(luma) => {
            luma.as_raw().iter().skip(1).step_by(2).any(partial)
        }
        _ => false,
    }
}

fn lossless_webp(decoded: &Decoded, budget: &MemoryBudget) -> Option<Vec<u8>> {
    if !png_converts_exactly(&decoded.image.bytes) {
        return None;
    }
    let _held = budget.take(decoded.pixels.checked_mul(WEBP_BYTES_PER_PIXEL)?)?;
    let image =
        image::load_from_memory_with_format(&decoded.image.bytes, image::ImageFormat::Png).ok()?;
    if dynamic_has_partial_alpha(&image) {
        return None;
    }
    let mut config = webp::WebPConfig::new().ok()?;
    let thorough = decoded.pixels <= WEBP_THOROUGH_PIXELS;
    config.lossless = 1;
    config.exact = 1;
    config.method = if thorough { 2 } else { 1 };
    config.quality = if thorough { 50.0 } else { 20.0 };
    let encoded = match image {
        image::DynamicImage::ImageRgb8(rgb) => {
            webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height())
                .encode_advanced(&config)
                .ok()?
        }
        other => {
            let rgba = other.into_rgba8();
            webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
                .encode_advanced(&config)
                .ok()?
        }
    };
    Some(encoded.to_vec())
}

fn recompress_png(bytes: &[u8], pixels: u64, tuning: Tuning) -> Option<Vec<u8>> {
    if pixels > MAX_LOSSLESS_PIXELS {
        return None;
    }
    let options = PngOptions {
        strip: StripChunks::Keep(RENDERING_CHUNKS.into_iter().collect()),
        ..PngOptions::from_preset(
            tuning
                .png_preset
                .map_or(preset_for(pixels), |preset| preset.min(6)),
        )
    };
    oxipng::optimize_from_memory(bytes, &options)
        .ok()
        .filter(|better| better.len() < bytes.len())
}

pub(crate) fn exact_candidates(
    bytes: &[u8],
    tuning: Tuning,
    webp_memory: Option<u64>,
) -> Vec<(Mime, Vec<u8>)> {
    let Ok(reader) = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format() else {
        return Vec::new();
    };
    let Ok((width, height)) = reader.into_dimensions() else {
        return Vec::new();
    };
    let pixels = u64::from(width) * u64::from(height);
    let mut candidates = Vec::new();
    if pixels <= MAX_LOSSLESS_PIXELS && crate::exact::oracle::png_recompress_eligible(bytes) {
        let options = PngOptions {
            strip: StripChunks::None,
            interlace: None,
            optimize_alpha: false,
            bit_depth_reduction: false,
            color_type_reduction: false,
            palette_reduction: false,
            grayscale_reduction: false,
            ..PngOptions::from_preset(
                tuning
                    .png_preset
                    .map_or(preset_for(pixels), |preset| preset.min(6)),
            )
        };
        if let Ok(png) = oxipng::optimize_from_memory(bytes, &options)
            && png.len() < bytes.len()
        {
            candidates.push((Mime::ImagePng, png));
        }
    }
    if let Some(memory) = webp_memory.filter(|_| crate::exact::oracle::webp_eligible(bytes)) {
        let decoded = Decoded {
            image: data::DataUri {
                mime: Mime::ImagePng,
                bytes: bytes.to_vec(),
            },
            pixels,
        };
        if let Some(webp) = lossless_webp(&decoded, &MemoryBudget::new(memory))
            && webp.len() < bytes.len()
        {
            candidates.push((Mime::ImageWebp, webp));
        }
    }
    candidates
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

pub(crate) fn recompress_png_file(bytes: &[u8], tuning: Tuning) -> Option<Vec<u8>> {
    let (width, height) = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    recompress_png(bytes, u64::from(width) * u64::from(height), tuning)
}

pub(crate) fn reencode_file(
    bytes: &[u8],
    encoding: ImageEncoding,
    width_limit: Option<u32>,
) -> Option<(Mime, Vec<u8>)> {
    let (source_width, source_height) = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    let pixels = u64::from(source_width) * u64::from(source_height);
    if pixels > MAX_LOSSY_PIXELS {
        return None;
    }
    let mut image = image::load_from_memory(bytes).ok()?.into_rgba8();
    let mut resized = false;
    if let Some(side) = encoding
        .max_side
        .filter(|&side| image.width().max(image.height()) > side.get())
    {
        image = shrink(image, side)?;
        resized = true;
    }
    if let Some(limit) = width_limit.filter(|&limit| image.width() > limit) {
        image = shrink_to_width(image, limit)?;
        resized = true;
    }
    let pixels = u64::from(image.width()) * u64::from(image.height());
    let (mime, encoded) = match encoding.format {
        ImageFormat::Avif => (
            Mime::ImageAvif,
            avif(&image, encoding.quality.get(), pixels)?,
        ),
        ImageFormat::Webp => (Mime::ImageWebp, webp(&image, encoding.quality.get())?),
    };
    (resized || encoded.len() * 10 < bytes.len() * 9).then_some((mime, encoded))
}

pub(crate) fn has_partial_alpha(bytes: &[u8]) -> bool {
    !image::load_from_memory(bytes)
        .ok()
        .is_some_and(|image| image.to_rgba8().pixels().all(|p| p.0[3] == 255))
}

fn shrink_to_width(image: RgbaImage, width: u32) -> Option<RgbaImage> {
    let (source_width, source_height) = (image.width(), image.height());
    let scale = f64::from(width) / f64::from(source_width);
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
