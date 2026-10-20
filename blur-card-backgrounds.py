"""Generate blurred JPEG copies of card photos without modifying the originals."""

from pathlib import Path

from PIL import Image, ImageFilter


SOURCE_DIR = Path(__file__).resolve().parent / "assets" / "images" / "backgrounds"
OUTPUT_DIR = SOURCE_DIR / "blur"
BLUR_RADIUS = 7  # Matches the previous CSS filter: blur(7px).


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    for source in sorted(SOURCE_DIR.glob("*.jpg")):
        destination = OUTPUT_DIR / source.name
        with Image.open(source) as original:
            blurred = original.convert("RGB").filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
            blurred.save(destination, format="JPEG", quality=85, optimize=True)
        print(f"{source.name} -> {destination.relative_to(SOURCE_DIR)}")


if __name__ == "__main__":
    main()