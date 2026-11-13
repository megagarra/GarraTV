#!/usr/bin/env python3
"""Generates the Microsoft Store (.appx) tile and logo images for the Windows app.

Without these, electron-builder ships its own sample tiles, and Store
certification rejects the package (policy 10.1.1.11: tiles must uniquely
represent the product). The images are drawn from the same 512px icon the Play
listing uses, so every store shows one mark.

electron-builder reads them from <buildResources>/appx/, which
scripts/package-windows.mjs points at desktop/. Scale and target-size variants
let Windows pick a sharp image at every DPI; makepri indexes them at build time.

Usage: python3 scripts/gen-appx-assets.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "play" / "icon-512.png"
OUT_DIR = ROOT / "desktop" / "appx"

# Matches the icon's own background, so tiles read as one surface. Keep in sync
# with appx.backgroundColor in scripts/package-windows.mjs.
BACKGROUND = (0, 0, 0, 255)

# name -> (width, height at scale-100, share of the shorter side the icon fills)
# Tiles that show the app name leave room for it under the icon.
ASSETS = {
    "StoreLogo": (50, 50, 1.0),
    "Square44x44Logo": (44, 44, 1.0),
    "SmallTile": (71, 71, 0.9),
    "Square150x150Logo": (150, 150, 0.72),
    "Wide310x150Logo": (310, 150, 0.72),
    "LargeTile": (310, 310, 0.72),
    "SplashScreen": (620, 300, 0.6),
}

# Scales whose icon still fits inside the 512px source without upscaling.
SCALES = (100, 200, 400)
MAX_ICON = 512

# Taskbar, Start list and Alt+Tab ask Square44x44Logo for exact pixel sizes.
TARGET_SIZES = (16, 24, 32, 48, 256)


def render(icon, width, height, share):
    canvas = Image.new("RGBA", (width, height), BACKGROUND)
    side = round(min(width, height) * share)
    mark = icon.resize((side, side), Image.LANCZOS)
    canvas.alpha_composite(mark, ((width - side) // 2, (height - side) // 2))
    return canvas.convert("RGB")


def main():
    icon = Image.open(SOURCE).convert("RGBA")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.png"):
        old.unlink()

    for name, (width, height, share) in ASSETS.items():
        for scale in SCALES:
            w, h = width * scale // 100, height * scale // 100
            if round(min(w, h) * share) > MAX_ICON:
                continue
            render(icon, w, h, share).save(OUT_DIR / f"{name}.scale-{scale}.png")

    for size in TARGET_SIZES:
        render(icon, size, size, 1.0).save(OUT_DIR / f"Square44x44Logo.targetsize-{size}.png")

    print(f"wrote {len(list(OUT_DIR.glob('*.png')))} images to {OUT_DIR}")


if __name__ == "__main__":
    main()
