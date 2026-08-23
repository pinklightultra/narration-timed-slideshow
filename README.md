# narration-timed-slideshow

Record yourself talking through a procedure. Point this at the audio and a folder of
screenshots. Get back an mp4 where each screenshot is held for exactly as long as you spent
talking about it.

The timing comes from your pauses. ffmpeg's `silencedetect` finds them, the speech between them
becomes one segment per step, and each segment gets one screenshot. There is no cue file to
author, no timeline to drag, and no browser automation.

230 lines, no npm dependencies, one external requirement: ffmpeg.

## Why this exists

I write documentation, and the procedures I document need short screencasts. The tools for that
want you to either record your screen live, which means performing the procedure flawlessly
while narrating it, or to build a timeline by hand, which means dragging clips until the audio
lines up.

Both are worse than the thing I actually wanted: I already have the screenshots, because I
captured them for the written version. I just want them held in time with my voice. Talking
through a procedure and pausing between steps is something I can do in one take, and the pauses
carry all the timing information the video needs.

## Install

**Not on npm.** Clone it:

```bash
git clone https://github.com/pinklightultra/narration-timed-slideshow
cd narration-timed-slideshow
```

There is nothing to `npm install`: `package.json` declares no dependencies, and the script uses
only Node builtins. `npm link` will put `narration-sync` on your PATH if you want it there.

ffmpeg is the one real prerequisite, and it brings `ffprobe` with it:

```bash
winget install Gyan.FFmpeg      # Windows
brew install ffmpeg             # macOS
sudo apt install ffmpeg         # Debian, Ubuntu
```

Then verify, which is not a formality here:

```bash
node scripts/smoke-test.js
```

It synthesizes its own audio and images with ffmpeg, runs the real CLI, and measures the output.
It needs no assets from you. **It exits 2 if ffmpeg is missing**, having run only the checks that
do not need it, because a partial run reporting green is the failure this repo is most keen to
avoid.

## Use

```bash
node narration-sync.js --audio narration.mp3 --screenshots ./shots --output out.mp4
```

Look before you render:

```bash
node narration-sync.js --audio narration.mp3 --screenshots ./shots --dry-run
```

`--dry-run` prints the detected segments, the screenshot order, and the concat list, and stops
before ffmpeg. It is the fastest way to find out that your pauses were not where you thought.

| Flag | Default | What it does |
|---|---|---|
| `--audio` | required | the narration file, anything ffmpeg can decode |
| `--screenshots` | required | a directory of `.png` / `.jpg` / `.jpeg` |
| `--output` | `./output/synced.mp4` | where to write |
| `--groups` | off | segments per screenshot, e.g. `3,2,1,4` |
| `--noise` | `-30` | silence threshold in dB. Lower catches quieter pauses |
| `--min-silence` | `0.4` | seconds of quiet before it counts as a pause |
| `--lead-in` | `0.15` | buffer after each cut, so the next word is not clipped |
| `--width`, `--height` | `1440`, `900` | output frame. Images are letterboxed, never cropped |
| `--dry-run` | off | plan and stop |
| `--keep-temp` | off | leave the concat list and silent video for inspection |

## When one pause is not one slide

The default maps segment `i` to screenshot `i`. That holds only when you paused once per
screenshot, and often you did not: three sentences about one screen, then one sentence about the
next. `--groups` says so explicitly.

```bash
node narration-sync.js --audio narration.mp3 --screenshots ./shots --groups 3,2,1,4
```

The first three detected segments merge onto screenshot 1, the next two onto screenshot 2, the
next one onto screenshot 3, the next four onto screenshot 4. The counts must sum to the detected
segment count exactly, and if they do not the script refuses and tells you both numbers. Run
`--dry-run` first to get the count.

## How it works

1. `silencedetect` on the audio, producing `silence_start` / `silence_end` pairs.
2. Invert them. The gaps between silences are speech segments, one per pause-delimited thing you
   said. Anything under 0.15s is dropped as a breath rather than a step.
3. Sort the screenshots by filename, numerically, and pair them with the segments.
4. Each hold runs from where the previous one stopped to the end of its segment plus `--lead-in`,
   so a pause is absorbed into the preceding screenshot instead of showing a blank frame.
5. Render a silent slideshow with the concat demuxer, then mux the narration onto it.

Step 4 has one exception worth knowing. The final hold also extends to the end of the audio,
because recordings virtually always end with a beat of silence after the last word. Without that,
the video stops short, ffmpeg's `-shortest` trims the audio down to match, and the tail of your
narration is cut off on every single run. If truncation happens anyway the script measures it,
warns with the number of seconds lost, and exits 2.

## Filename order

Screenshots are sorted numerically, not lexicographically. `shot-2.png` comes before
`shot-10.png`.

This is called out because the plain-sort version of the bug is invisible. `sort()` orders
`shot-1, shot-10, shot-2`, which yields a video with your steps in the wrong order, no error
anywhere, and a success message at the end. Zero-padded filenames sort correctly under both
rules, so if your first test used `01, 02, 03` you would never see it. Two of the smoke test's
checks exist for this one thing, and one of them asserts that the naive sort really is wrong,
so the test cannot quietly stop testing anything.

## Limitations

- **The end-to-end render is unverified by me.** ffmpeg is not installed on the machine I built
  this on, so the six pure checks in the smoke test are the only ones I have seen pass. The
  render path is adapted from a version that produced real output, but I am not going to claim
  a green run I did not watch. Install ffmpeg, run `node scripts/smoke-test.js`, and it will
  tell you rather than me.
- **One screenshot per segment, in order.** There is no zooming, panning, cursor, highlight, or
  transition. Every cut is hard. If you want motion, this is the wrong tool.
- **It trusts your pauses.** A filler word in a gap, a cough, or a room with a noise floor above
  `--noise` all change the segment count. `--dry-run` and `--groups` are the answer, and both
  are manual.
- **Mismatched counts warn rather than stop.** More segments than screenshots holds on the last
  one; more screenshots than segments drops the extras from the end. Both print a warning and
  continue, which is a deliberate choice and also the thing most likely to surprise you.
- **Re-encodes twice.** Once for the silent slideshow, once for the mux. Fine for a few minutes
  of screenshots; wasteful for anything long.
- **No tests of the ffmpeg arguments themselves.** The smoke test checks that a video comes out
  with the right duration and ordering. It does not check the pixels.

## Background

Built while running documentation for a healthcare SaaS platform, where every procedure I wrote
up also wanted a ninety-second video, and building those by hand in a timeline editor was the
part of the job I most wanted to stop doing.

It started inside a larger narration-driven capture pipeline that also drove a browser from
transcript timestamps. That part was tied to one application and stayed behind. This is the piece
that turned out to need nothing but ffmpeg, a folder, and a voice.

## License

MIT. See [LICENSE](LICENSE).
