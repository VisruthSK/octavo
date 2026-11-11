use crate::{
    data::{self, Mime},
    doc::{Doc, Edit},
    html::{AttrName, Element, Tag},
    ImageEncoding, ImageFormat, Target, Transform,
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
use std::{cmp::Reverse, io::Cursor, num::NonZeroU32};

const MAX_LOSSLESS_PIXELS: u64 = 40_000_000;
const MAX_LOSSY_PIXELS: u64 = 200_000_000;
const THOROUGH_PIXELS: u64 = 2_000_000;
const HEAVY_PIXELS: u64 = 8_000_000;

struct Decoded {
    image: data::DataUri,
    pixels: u64,
}

struct EncodedUri<'a> {
    attr: AttrName,
    value: &'a str,
    decoded: Option<Decoded>,
    converted: Option<String>,
}

struct Candidate<'a> {
    tag: &'a Tag,
    uris: Vec<EncodedUri<'a>>,
}

enum Effort {
    Light,
    Standard,
    Thorough,
}

impl Effort {
    fn preset(self) -> u8 {
        match self {
            Effort::Light => 1,
            Effort::Standard => 2,
            Effort::Thorough => 4,
        }
    }
}

fn flat<'i, 'a>(images: &'i [Candidate<'a>]) -> Vec<&'i EncodedUri<'a>> {
    images.iter().flat_map(|image| image.uris.iter()).collect()
}

fn jobs_mut<'i, 'a>(images: &'i mut [Candidate<'a>]) -> Vec<&'i mut EncodedUri<'a>> {
    images
        .iter_mut()
        .flat_map(|image| image.uris.iter_mut())
        .collect()
}

pub(crate) fn stage(doc: &Doc, lossy: Option<ImageEncoding>) -> Vec<Edit> {
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
                    decoded: None,
                    converted: None,
                })
                .collect(),
        })
        .collect();
    let jobs = jobs_mut(&mut images);
    jobs.into_par_iter().for_each(|uri| {
        uri.decoded = decode(uri.value);
    });
    let mut largest_first: Vec<(usize, u64)> = flat(&images)
        .into_iter()
        .enumerate()
        .filter_map(|(at, uri)| uri.decoded.as_ref().map(|decoded| (at, decoded.pixels)))
        .collect();
    largest_first.sort_by_key(|&(_, pixels)| Reverse(pixels));
    let uris = flat(&images);
    let converted: Vec<(usize, String)> = largest_first
        .into_par_iter()
        .with_max_len(1)
        .filter_map(|(at, _)| {
            let decoded = uris[at].decoded.as_ref()?;
            reencode(decoded, lossy).map(|uri| (at, uri))
        })
        .collect();
    let mut jobs = jobs_mut(&mut images);
    for (at, uri) in converted {
        jobs[at].converted = Some(uri);
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

fn reencode(decoded: &Decoded, lossy: Option<ImageEncoding>) -> Option<String> {
    lossy
        .and_then(|encoding| encode(decoded, encoding))
        .or_else(|| recompress(decoded))
}

fn recompress(decoded: &Decoded) -> Option<String> {
    if decoded.image.mime != Mime::ImagePng || decoded.pixels > MAX_LOSSLESS_PIXELS {
        return None;
    }
    let effort = if decoded.pixels <= THOROUGH_PIXELS {
        Effort::Thorough
    } else if decoded.pixels <= HEAVY_PIXELS {
        Effort::Standard
    } else {
        Effort::Light
    };
    let options = PngOptions {
        strip: StripChunks::Safe,
        ..PngOptions::from_preset(effort.preset())
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
