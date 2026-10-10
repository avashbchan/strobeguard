# Test clips

> ⚠️ **Photosensitivity warning:** these clips contain intense, rapid flashing (strobes, lasers, red flashes). Don't watch them directly if you are photosensitive. Test with the StrobeGuard output and graphs instead.

The video files are **not in git**. Download them from Google Drive:

**https://drive.google.com/file/d/1sIoJyPUArNgghM3BiioAKdjlMWLo06eu/view?usp=drive_link**

## Setup

1. Download `strobeguard-clips-360p.zip` (65 MB) from the link above.
2. Unzip it **inside this `clips/` folder**. The zip holds the `.mp4` files at its top level, so they land directly in `clips/`.
3. That's it. `.gitignore` ignores everything in `clips/` except this README, so the videos are never committed.

```bash
cd clips && unzip ~/Downloads/strobeguard-clips-360p.zip
```

## What's in it

13 clips, about 68 MB in total:
- 12 screen recordings of livestream / concert footage with flashing sections, 32–68 s each.
- `salvia simulation.mp4`, 45 s.

All are already **360p at 30 fps**: H.264 video (CRF 28) with AAC audio at 96 kbps. They can be used as they are, with no conversion step.

Most file names contain a narrow no-break space (U+202F) before "AM"/"PM", because that's how macOS names screen recordings. If a script can't find a file by its typed name, match it with a glob such as `clips/*4.34.51*`.

## How they were made

The originals (3024×1698 variable-frame-rate screen recordings and a 1080p clip, 3.3 GB in total) were shrunk with:

```bash
mkdir -p clips-small
for f in clips/*.mov clips/*.mp4; do
  base=$(basename "$f")
  ffmpeg -nostdin -n -i "$f" -vf "scale=-2:360,fps=30" \
    -c:v libx264 -preset medium -crf 28 -pix_fmt yuv420p \
    -c:a aac -b:a 96k -movflags +faststart "clips-small/${base%.*}.mp4"
done
```

The strobe sections survive the shrink. Frame-to-frame brightness jumps (≥ 25 luma levels) were checked:

| Clip | Original | 360p | Flashing seconds |
|---|---|---|---|
| 4.34.51 AM | 1347 | 1343 | 68 of 68 |
| 4.40.05 PM | 43 | 43 | 27 |
| 4.18.03 PM | 26 | 27 | 9–10 |

The full-resolution originals are kept by Avash, in case a clip needs re-cutting.
