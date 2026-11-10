# How a hold is timed

[Back to the README](../README.md).

A written procedure already has its screenshots. The video of that procedure is usually made a second way: perform the steps again while talking, in one clean take, or drop the stills on a timeline and nudge them until they meet the voice.

A narration recorded against the stills already contains the timing, if you pause between steps. Each stretch of speech is one step. Each step already has a picture. The job is to read the pauses and hold the matching file.

The implementation is [`narration-sync.js`](../narration-sync.js). `main()` runs the steps in the order below.

## 1. Find the pauses

`detectSilences()` runs ffmpeg's `silencedetect` filter and parses `silence_start` / `silence_end` from the filter log. `--noise` (default `-30`) is the dB threshold; audio below it is silence. `--min-silence` (default `0.4`) is how long that quiet has to last before it counts.

The filter's own defaults are different, and the script overrides both. `ffmpeg -h filter=silencedetect` on ffmpeg 6.1.1 reports a noise tolerance of `0.001` (an amplitude; `20 * log10(0.001)` is -60 dB) and a minimum duration of 2 s. `detectSilences()` passes `noise=-30dB:d=0.4` unless you change `--noise` or `--min-silence`. Running the filter by hand, with no arguments, is a different detection.

A non-zero ffmpeg exit with no `silencedetect` line in the log is a decode failure and throws. A log that contains the filter is parsed even when ffmpeg exits non-zero. The filter writes to stderr, and ffmpeg's status is not a reliable signal that detection itself failed.

## 2. Invert the pauses into speech

`silencesToSpeechSegments()` takes the gaps between silences, from 0 to the duration `ffprobe` reported. A gap of 0.15 s or shorter is dropped (`seg.end - seg.start > 0.15`). That cutoff is for a breath or a click. It is not a flag.

## 3. Merge, when you say how

`--groups 3,2,1,4` is read by `applyGroups()`. Each integer is how many consecutive speech segments share one screenshot. The integers have to be 1 or greater, and they have to sum to the detected segment count. Any other sum exits 1 and prints both numbers.

## 4. Order the files

`naturalSort()` compares names with `localeCompare(other, undefined, { numeric: true, sensitivity: 'base' })`. `shot-2.png` comes before `shot-10.png`. The directory listing is filtered to `.png`, `.jpg`, and `.jpeg`.

A plain `Array.prototype.sort()` orders `shot-1`, `shot-10`, `shot-2`. The video would play in that order, the process would exit 0, and the log would say done. Zero-padded names hide it: `01`, `02`, `10` sort the same under both comparisons, so a first test that used padded names would not see the failure. The smoke test uses unpadded names, and it asserts that the plain sort is wrong on those names. Removing the numeric compare fails that check.

## 5. Build one contiguous hold per segment

Holds tile the timeline from zero. There is no gap and no blank frame between them. Hold *i* ends at the end of speech segment *i* plus `--lead-in` (default `0.15` s), measured from where the previous hold stopped. The last hold ends at the later of that point and the end of the audio, so a trailing pause stays in the file. Every hold is at least 0.3 s (`Math.max(0.3, ...)` in the concat loop).

`--lead-in` is the part of the pause that stays on the screenshot you were just talking about, so the cut does not land on the first syllable of the next word. Any pause longer than the lead-in shows the *next* screenshot for the rest of the quiet. The next picture is already up when the next sentence starts.

This is a trace of `silencesToSpeechSegments()` and of that formula, on a 5.0 s file with silences at 1.0–1.6 s and 3.0–5.0 s and `--lead-in 0.15`. A dry run of a generated file with tone at 0.0–1.0 s and 1.6–3.0 s (ffmpeg 6.1.1) reported those two segments and concat durations `1.150` and `3.850`. The table is those durations. It is not a frame capture. The silent file is encoded with `-vsync vfr`, so a cut can be stamped on a nearby tick.

| Hold | Speech the detector returned | On screen |
|---|---|---|
| Screenshot 1 | 0.0–1.0 s | 0.00–1.15 s |
| Screenshot 2 | 1.6–3.0 s | 1.15–5.00 s |

The 0.45 s of pause after 1.15 s plays under screenshot 2. The last hold runs to 5.00 s because the take ends in silence.

## 6. Encode the slideshow, then mux the voice

The concat demuxer writes a silent video at `--width` by `--height` (default 1440x900). The scale filter fits each image inside that frame and keeps the aspect ratio. A source smaller than the frame is enlarged until one edge meets it. The other axis is padded in black. The picture is not cropped. A second ffmpeg invocation muxes the narration: H.264 at `-crf 20` with `-preset fast`, AAC at 128 kbps, and `-shortest`. The concat list and the silent video are deleted after the mux. `--keep-temp` leaves both beside the output, named `<output>.concat.txt` and `<output>.silent.mp4`.

`-shortest` ends the file when the shorter stream ends. If the audio that remains is more than 0.25 s shorter than the source, the script prints the missing duration and exits 2. The mp4 is still on disk. The last-hold extension is what keeps a normal trailing pause from taking that path. The warning is the backstop when the video is still short.

If the segment count and the screenshot count differ, the script warns and continues. Extra segments hold the last screenshot. Extra screenshots are dropped from the end of the sorted list. `--groups` is how you say the mismatch was a choice.

## What the duration line is counting

The log ends with the path, the size, and a duration line:

```text
duration: 6.0s  (audio 6.0s, video 4.4s)
```

That line is from a real run of the smoke test's fixture: the 6 s tone, `shot-1.png`, `shot-2.png`, `shot-10.png`, rendered at 320x240, on ffmpeg 6.1.1. The first number is the muxed file. `audio` is the source. `video` is `ffprobe`'s format duration of the silent intermediate, measured before the mux. That intermediate is variable frame rate. In this run its container duration was 4.360 s, and its four frame timestamps were 0.000, 1.160, 3.160, and 6.000. The muxed file was 6.000 s. The process exited 0. The truncation warning did not fire.

Read the first number. A smaller `video` figure is the container duration of that intermediate, not a trimmed narration. The truncation check compares the muxed file with the source audio and fires when the shortfall is over 0.25 s.

On a render, exit 0 means the mux finished and that check did not fire. A count mismatch is a warning on that same exit. It does not fail the process. With two screenshots against the three segments of that 6 s fixture, the script warned that the extra segments would hold on the last screenshot, wrote the mp4, and exited 0. Exit 2 means the file was written and the end of the narration was trimmed. The warning names the number of seconds.

Inside the file: your screenshots, in numeric filename order, each held for the interval in step 5, with the narration on the audio track. Every cut is hard. The frame does not zoom, pan, or highlight.
