use crate::common::{optimized, simplified};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, Crc, write::ZlibEncoder};
use image::ImageEncoder;
use octavo::{ImageEncoding, ImageFormat, Mode, Options};
use std::io::Write;
use std::num::NonZeroU32;

fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut crc = Crc::new();
    crc.update(kind);
    crc.update(body);
    [
        &(body.len() as u32).to_be_bytes()[..],
        kind,
        body,
        &crc.sum().to_be_bytes(),
    ]
    .concat()
}

fn png_with_chunks(chunks: &[Vec<u8>]) -> Vec<u8> {
    let mut header = Vec::new();
    header.extend_from_slice(&4u32.to_be_bytes());
    header.extend_from_slice(&4u32.to_be_bytes());
    header.extend_from_slice(&[8, 0, 0, 0, 0]);
    let rows: Vec<u8> = (0..4)
        .flat_map(|y| std::iter::once(0).chain((0..4).map(move |x| (x * 60 + y * 7) as u8)))
        .collect();
    let mut zlib = ZlibEncoder::new(Vec::new(), Compression::fast());
    zlib.write_all(&rows).unwrap();
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend(chunk(b"IHDR", &header));
    png.extend(chunks.concat());
    png.extend(chunk(b"IDAT", &zlib.finish().unwrap()));
    png.extend(chunk(b"IEND", &[]));
    png
}

fn png_with_comment(comment: &str) -> Vec<u8> {
    png_with_chunks(&[chunk(b"tEXt", format!("Comment\0{comment}").as_bytes())])
}

fn png_only(src: &str) -> String {
    simplified(
        src,
        Options {
            keep_png: true,
            ..Options::default()
        },
    )
    .pack(Mode::Safe)
    .html
}

fn page(attr: &str, png: &[u8]) -> String {
    let uri = format!("data:image/png;base64,{}", STANDARD.encode(png));
    format!(
        "<!DOCTYPE html><html><body><img class=\"figure\" {attr}=\"{uri}\" alt=\"a\"></body></html>"
    )
}

fn embedded_png(html: &str) -> Vec<u8> {
    let start = html.find("data:image/png;base64,").unwrap() + "data:image/png;base64,".len();
    let end = start + html[start..].find('"').unwrap();
    STANDARD.decode(&html[start..end]).unwrap()
}

#[test]
fn embedded_pngs_are_recompressed_in_src_and_data_src() {
    let original = png_with_comment(&"metadata ".repeat(300));
    for attr in ["src", "data-src"] {
        let out = png_only(&page(attr, &original));
        let smaller = embedded_png(&out);
        assert!(
            smaller.len() < original.len() / 2,
            "{attr}: {} vs {}",
            smaller.len(),
            original.len()
        );
        assert!(smaller.starts_with(b"\x89PNG"));
        assert!(out.contains("class=\"figure\"") && out.contains("alt=\"a\""));
    }
}

#[test]
fn already_minimal_pngs_and_other_formats_are_untouched() {
    let minimal = optimized(&page("src", &png_with_comment("")), Mode::Safe).html;
    assert_eq!(optimized(&minimal, Mode::Safe).html, minimal);
    let gif = crate::common::page(
        "",
        &format!(
            "<img src=\"{}\">",
            crate::common::data_uri("image/gif", b"GIF89a0000")
        ),
    );
    assert_eq!(optimized(&gif, Mode::Safe).html, gif);
}

#[test]
fn a_recompressed_png_keeps_its_dimensions_and_ends_properly() {
    let original = png_with_comment(&"x".repeat(2000));
    let optimized = embedded_png(&png_only(&page("src", &original)));
    assert_eq!(optimized[16..24], original[16..24]);
    assert!(optimized.ends_with(&chunk(b"IEND", &[])));
}

fn photographic_png() -> Vec<u8> {
    let (width, height) = (96u32, 96u32);
    let mut rgba = Vec::new();
    for y in 0..height {
        for x in 0..width {
            rgba.extend([(x * 2 + y) as u8, (x ^ y) as u8, (y * 2) as u8, 255]);
        }
    }
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .unwrap();
    png
}

fn lossy(format: ImageFormat, max_side: Option<NonZeroU32>) -> Options {
    let mut options = Options::default();
    let mut encoding = ImageEncoding::new(format);
    encoding.max_side = max_side;
    options.images = Some(encoding);
    options
}

#[test]
fn lossy_mode_re_encodes_photographic_pngs_in_the_requested_format() {
    let src = page("src", &photographic_png());
    for (format, mime) in [
        (ImageFormat::Avif, "image/avif"),
        (ImageFormat::Webp, "image/webp"),
    ] {
        let out = simplified(&src, lossy(format, None)).pack(Mode::Safe).html;
        assert!(
            out.contains(&format!("data:{mime};base64,")),
            "{mime}: {out:.200}"
        );
        assert!(out.len() < src.len());
    }
    let lossless = simplified(&src, Options::default()).pack(Mode::Safe).html;
    assert!(!lossless.contains("data:image/avif"));
}

#[test]
fn oversized_images_shrink_without_touching_the_tag() {
    let src = page("src", &photographic_png());
    let full = simplified(&src, lossy(ImageFormat::Webp, None))
        .pack(Mode::Safe)
        .html;
    let shrunk = simplified(&src, lossy(ImageFormat::Webp, NonZeroU32::new(24)))
        .pack(Mode::Safe)
        .html;
    assert!(shrunk.len() < full.len());
    assert!(shrunk.contains("<img class=\"figure\" src=\"data:image/webp;base64,"));
    assert!(!shrunk.contains("width=") && !shrunk.contains("height="));
}

fn chunk_names(png: &[u8]) -> Vec<[u8; 4]> {
    let mut names = Vec::new();
    let mut at = 8;
    while at + 8 <= png.len() {
        let length = u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
        names.push(png[at + 4..at + 8].try_into().unwrap());
        at += 12 + length;
    }
    names
}

#[test]
fn recompression_keeps_the_chunks_that_change_how_colours_render() {
    let original = png_with_chunks(&[
        chunk(b"gAMA", &45455u32.to_be_bytes()),
        chunk(b"cHRM", &[0; 32]),
        chunk(b"eXIf", b"MM\0*\0\0\0\x08\0\0\0\0\0\0\0\0"),
        chunk(b"tEXt", format!("Comment\0{}", "x".repeat(2000)).as_bytes()),
    ]);
    let out = optimized(&page("src", &original), Mode::Safe).html;
    let names = chunk_names(&embedded_png(&out));
    for kept in [b"gAMA", b"cHRM", b"eXIf"] {
        assert!(
            names.contains(kept),
            "{:?} lost from {names:?}",
            String::from_utf8_lossy(kept)
        );
    }
    assert!(!names.contains(b"tEXt"), "{names:?}");
}

#[test]
fn repeated_images_are_recompressed_once_and_distinct_ones_stay_independent() {
    let first = png_with_comment(&"metadata ".repeat(300));
    let second = photographic_png();
    let uri = |png: &[u8]| format!("data:image/png;base64,{}", STANDARD.encode(png));
    let tags: String = (0..50)
        .map(|n| {
            format!(
                "<img alt=\"{n}\" src=\"{}\">",
                uri(if n % 10 == 0 { &second } else { &first })
            )
        })
        .collect();
    let out = png_only(&format!("<!DOCTYPE html><html><body>{tags}</body></html>"));
    let shrunk_first = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(embedded_png(&png_only(&page("src", &first))))
    );
    let shrunk_second = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(embedded_png(&png_only(&page("src", &second))))
    );
    assert_eq!(out.matches(&shrunk_first).count(), 45, "{}", out.len());
    assert_eq!(out.matches(&shrunk_second).count(), 5);
    assert!(out.len() < tags.len() / 2);
}

fn flat_rgba(width: u32, height: u32, hidden: bool) -> Vec<u8> {
    (0..width * height)
        .flat_map(|i| {
            let (x, y) = (i % width, i / width);
            let band = ((x / 16) + (y / 16)) % 3;
            let colour = [[200u8, 30, 30], [30, 200, 30], [30, 30, 200]][band as usize];
            if hidden && x % 7 == 0 {
                [250, 10, 10, 0]
            } else {
                [colour[0], colour[1], colour[2], 255]
            }
        })
        .collect()
}

fn encode_png(pixels: &[u8], width: u32, height: u32, color: image::ColorType) -> Vec<u8> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(pixels, width, height, color.into())
        .unwrap();
    out
}

fn embedded_webp(html: &str) -> Option<Vec<u8>> {
    let marker = "data:image/webp;base64,";
    let start = html.find(marker)? + marker.len();
    let end = start + html[start..].find('"')?;
    Some(STANDARD.decode(&html[start..end]).unwrap())
}

fn decoded_rgba(webp: &[u8]) -> Vec<u8> {
    let decoded = webp::Decoder::new(webp).decode().expect("valid WebP");
    if decoded.is_alpha() {
        decoded.to_vec()
    } else {
        decoded
            .chunks(3)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2], 255])
            .collect()
    }
}

fn with_chunk_after_header(png: &[u8], extra: &[u8]) -> Vec<u8> {
    let at = 8 + 12 + 13;
    [&png[..at], extra, &png[at..]].concat()
}

#[test]
fn a_flat_png_becomes_lossless_webp_with_the_same_pixels() {
    let pixels = flat_rgba(96, 96, false);
    let png = encode_png(&pixels, 96, 96, image::ColorType::Rgba8);
    let html = optimized(&page("src", &png), Mode::Safe).html;
    let webp = embedded_webp(&html).expect("the image is WebP");
    assert!(webp.len() < png.len());
    assert_eq!(decoded_rgba(&webp), pixels);
}

#[test]
fn colours_hidden_under_transparency_survive_the_conversion() {
    let pixels = flat_rgba(96, 96, true);
    let png = encode_png(&pixels, 96, 96, image::ColorType::Rgba8);
    let html = optimized(&page("src", &png), Mode::Safe).html;
    let webp = embedded_webp(&html).expect("the image is WebP");
    assert_eq!(decoded_rgba(&webp), pixels);
}

#[test]
fn keep_png_leaves_the_image_a_png() {
    let png = encode_png(&flat_rgba(96, 96, false), 96, 96, image::ColorType::Rgba8);
    let out = png_only(&page("src", &png));
    assert!(embedded_webp(&out).is_none() && out.contains("data:image/png;base64,"));
}

#[test]
fn a_png_with_a_gamma_chunk_stays_a_png() {
    let png = encode_png(&flat_rgba(96, 96, false), 96, 96, image::ColorType::Rgba8);
    let tagged = with_chunk_after_header(&png, &chunk(b"gAMA", &45455u32.to_be_bytes()));
    let html = optimized(&page("src", &tagged), Mode::Safe).html;
    assert!(embedded_webp(&html).is_none() && html.contains("data:image/png;base64,"));
}

#[test]
fn a_png_with_partly_transparent_pixels_stays_a_png() {
    let mut pixels = flat_rgba(96, 96, false);
    pixels[3] = 16;
    let png = encode_png(&pixels, 96, 96, image::ColorType::Rgba8);
    let html = optimized(&page("src", &png), Mode::Safe).html;
    assert!(embedded_webp(&html).is_none());
}

#[test]
fn a_sixteen_bit_png_stays_a_png() {
    let pixels: Vec<u8> = (0..96 * 96)
        .flat_map(|_| [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff])
        .collect();
    let png = encode_png(&pixels, 96, 96, image::ColorType::Rgba16);
    let html = optimized(&page("src", &png), Mode::Safe).html;
    assert!(embedded_webp(&html).is_none());
}
