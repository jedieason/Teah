# /// script
# requires-python = ">=3.11"
# dependencies = ["Pillow==13.0.0"]
# ///

"""Convert one already selected question image into a WebP or API payload."""

import argparse
import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageCms, ImageOps


MAX_IMAGE_BYTES = 512 * 1024
MAX_SOURCE_PIXELS = 40_000_000
LONG_EDGE_STEPS = (2400, 2160, 1920, 1680, 1440, 1280)
SOURCE_FORMATS = ("PNG", "JPEG", "WEBP")


def read_image(path: Path) -> Image.Image:
    with path.open("rb") as file:
        header = file.read(25)
        file.seek(0)
        with Image.open(file, formats=SOURCE_FORMATS) as source:
            if source.width * source.height > MAX_SOURCE_PIXELS:
                raise ValueError("來源超過 4,000 萬像素，請先裁出題圖範圍。")
            if getattr(source, "n_frames", 1) != 1:
                raise ValueError("請選擇單張靜態圖檔。")
            # PNG IHDR stores its original bit depth before Pillow expands RGB pixels.
            if source.format == "PNG" and header[24:25] == b"\x10":
                raise ValueError("請先確認顯示亮度與細節，再將 16-bit PNG 匯出為 8-bit 圖檔。")

            upright = ImageOps.exif_transpose(source)
            alpha = upright.convert("RGBA").getchannel("A") if upright.has_transparency_data else None
            profile = upright.info.get("icc_profile")
            if profile:
                color = upright
                if upright.mode in {"P", "RGBA"}:
                    color = upright.convert("RGB")
                elif upright.mode in {"1", "LA"}:
                    color = upright.convert("L")
                result = ImageCms.profileToProfile(
                    color, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                    ImageCms.createProfile("sRGB"), outputMode="RGB",
                )
            else:
                result = upright.convert("RGB")
            if alpha is not None:
                result.putalpha(alpha)
            result.info.clear()
            return result


def convert(image: Image.Image) -> tuple[bytes, tuple[int, int]]:
    long_edge = max(image.size)
    first_step = min(long_edge, LONG_EDGE_STEPS[0])
    steps = (first_step, *(step for step in LONG_EDGE_STEPS if step < first_step))
    for step in steps:
        candidate = image
        if step < long_edge:
            size = tuple(max(1, round(dimension * step / long_edge)) for dimension in image.size)
            candidate = image.resize(size, Image.Resampling.LANCZOS)

        output = io.BytesIO()
        candidate.save(output, format="WEBP", lossless=True, quality=100, method=6, exact=True)
        if output.tell() <= MAX_IMAGE_BYTES:
            return output.getvalue(), candidate.size

    raise ValueError("題圖在設定的尺寸下仍超過 512 KiB。請裁掉無關邊緣並重新檢查細節。")


def main() -> None:
    parser = argparse.ArgumentParser(description="將已選定的單張題圖輸出為無損 WebP 或 Agent API Base64 JSON。")
    parser.add_argument("source", type=Path, help="單張 PNG、JPEG 或 WebP")
    parser.add_argument("output", type=Path, help="輸出 .webp 或 .json")
    args = parser.parse_args()

    try:
        suffix = args.output.suffix.lower()
        if suffix not in {".webp", ".json"}:
            raise ValueError("輸出副檔名須為 .webp 或 .json。")
        if args.output.exists():
            raise ValueError("輸出檔案已存在，請指定新路徑。")
        image = read_image(args.source)
        webp, (width, height) = convert(image)
        data = webp
        if suffix == ".json":
            payload = {"contentType": "image/webp", "base64": base64.b64encode(webp).decode("ascii")}
            data = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        with args.output.open("xb") as output:
            output.write(data)
        print(f"{args.output} · WebP {width} × {height} · {len(webp):,} bytes")
    except (OSError, ValueError, Image.DecompressionBombError, ImageCms.PyCMSError) as error:
        parser.exit(1, f"題圖轉檔失敗：{error}\n")


if __name__ == "__main__":
    main()
