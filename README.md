# narration-timed-slideshow

`narration-sync` builds an mp4 that holds a folder of screenshots under a narration you record yourself. The cuts come from the pauses. A screenshot stays up through the speech for its step and through a short lead-in after that speech. The last screenshot stays up through whatever silence the take ends on.

It is for a technical writer who already captured those screenshots for the article and needs the same frames in a short video. You bring an audio file and a directory of images. The script writes the mp4. ffmpeg finds the silences. Node pairs them with the files. There are no npm dependencies, and this repository is not published to npm.

- [Problem](#problem)
- [Method](#method)
- [Result](#result)
- [Requirements](#requirements)
- [Install](#install)
- [Render](#render)
- [When one pause is not one slide](#when-one-pause-is-not-one-slide)
- [Slideshow Studio](#slideshow-studio)
- [Tests](#tests)
- [Limitations](#limitations)
- [Background](#background)
- [License](#license)

## Problem

A written procedure already has its screenshots. The video of that procedure is usually made a second way: perform the steps again while talking, in one clean take, or drop the stills on a timeline and nudge them until they meet the voice.

A narration recorded against the stills already contains the timing, if you pause between steps. Each stretch of speech is one step. Each step already has a picture. The job is to read the pauses and hold the matching file.

## Method

The implementation is [`narration-sync.js`](narration-sync.js). `main()` runs the steps in the order below. The hold comment and the hold arithmetic do not say the same thing. The arithmetic is the behavior.

**1. Find the pauses.** `detectSilences()` runs ffmpeg's `silencedetect` filter and parses `silence_start` / `silence_end` from the filter log. `--noise` (default `-30`) is the dB threshold; audio below it is silence. `--min-silence` (default `0.4`) is how long that quiet has to last before it counts.

The filter's own defaults are different, and the script overrides both. `ffmpeg -h filter=silencedetect` reports a noise tolerance of `0.001` (an amplitude; `20 * log10(0.001)` is -60 dB) and a minimum duration of 2 s. `detectSilences()` passes `noise=-30dB:d=0.4` unless you change `--noise` or `--min-silence`. Running the filter by hand, with no arguments, is a different detection.

A non-zero ffmpeg exit with no `silencedetect` line in the log is a decode failure and throws. A log that contains the filter is parsed even when ffmpeg exits non-zero. The filter writes to stderr, and ffmpeg's status is not a reliable signal that detection itself failed.

**2. Invert the pauses into speech.** `silencesToSpeechSegments()` takes the gaps between silences, from 0 to the duration `ffprobe` reported. A gap of 0.15 s or shorter is dropped. That cutoff is for a breath or a click. It is not a flag.

**3. Merge, when you say how.** `--groups 3,2,1,4` is read by `applyGroups()`. Each integer is how many consecutive speech segments share one screenshot. The integers have to be 1 or greater, and they have to sum to the detected segment count. Any other sum exits 1 and prints both numbers.

**4. Order the files.** `naturalSort()` compares names with `localeCompare(..., { numeric: true })`. `shot-2.png` comes before `shot-10.png`. The directory listing is filtered to `.png`, `.jpg`, and `.jpeg`.

A plain `Array.prototype.sort()` orders `shot-1`, `shot-10`, `shot-2`. The video would play in that order, the process would exit 0, and the log would say done. Zero-padded names hide it: `01`, `02`, `10` sort the same under both comparisons, so a first test that used padded names would not see the failure. The smoke test uses unpadded names, and it asserts that the plain sort is wrong on those names. Removing the numeric compare fails that check.

**5. Build one contiguous hold per segment.** Holds tile the timeline from zero. There is no gap and no blank frame between them. Hold *i* ends at the end of speech segment *i* plus `--lead-in` (default `0.15` s), measured from where the previous hold stopped. The last hold ends at the later of that point and the end of the audio, so a trailing pause stays in the file. Every hold is at least 0.3 s (`Math.max(0.3, ...)` in the concat loop).

`--lead-in` is the part of the pause that stays on the screenshot you were just talking about, so the cut does not land on the first syllable of the next word. Any pause longer than the lead-in shows the *next* screenshot for the rest of the quiet. The next picture is already up when the next sentence starts.

The comment on that loop says the pause is absorbed into the preceding screenshot. The lead-in is. The remainder is not.

This is a trace of `silencesToSpeechSegments()` and of that formula, on a made-up 5.0 s file with silences at 1.0–1.6 s and 3.0–5.0 s and `--lead-in 0.15`. It is not a measured render.

| Hold | Speech the detector returned | On screen |
|---|---|---|
| Screenshot 1 | 0.0–1.0 s | 0.00–1.15 s |
| Screenshot 2 | 1.6–3.0 s | 1.15–5.00 s |

The 0.45 s of pause after 1.15 s plays under screenshot 2. The last hold runs to 5.00 s because the take ends in silence.

**6. Encode the slideshow, then mux the voice.** The concat demuxer writes a silent video at `--width` by `--height` (default 1440x900). The scale filter fits each image inside that frame and keeps the aspect ratio. A source smaller than the frame is enlarged until one edge meets it. The other axis is padded in black. The picture is not cropped. A second ffmpeg invocation muxes the narration: H.264 at `-crf 20` with `-preset fast`, AAC at 128 kbps, and `-shortest`. The concat list and the silent video are deleted after the mux. `--keep-temp` leaves both beside the output, named `<output>.concat.txt` and `<output>.silent.mp4`.

`-shortest` ends the file when the shorter stream ends. If the audio that remains is more than 0.25 s shorter than the source, the script prints the missing duration and exits 2. The mp4 is still on disk. The last-hold extension is what keeps a normal trailing pause from taking that path. The warning is the backstop when the video is still short.

If the segment count and the screenshot count differ, the script warns and continues. Extra segments hold the last screenshot. Extra screenshots are dropped from the end of the sorted list. `--groups` is how you say the mismatch was a choice.

## Result

One mp4. The default path is `./output/synced.mp4`. Parent directories are created. The log prints the path, the file size, and three durations: the muxed file, the source audio, and the silent slideshow.

Inside the file: your screenshots, in numeric filename order, each held for the interval in step 5, with the narration on the audio track. Every cut is hard. The frame does not zoom, pan, or highlight.

On a render, exit 0 means the mux finished and the audio was not trimmed. A count mismatch is a warning on that same exit. It does not fail the process. Exit 2 means the file was written and the end of the narration was trimmed. The warning names the number of seconds.

## Requirements

- **Node.js.** `package.json` declares `>=16`. The workflow runs the smoke test on 18, 20, and 22. Node 16 is the declared floor. It is not one of the versions the workflow installs.
- **ffmpeg and ffprobe on `PATH`.** `requireBinaries()` checks both before it reads the audio. The error names the install command. A missing ffmpeg would otherwise surface as `ENOENT` from inside `execFileSync`, which reads like a bug in the script.
- **A narration ffmpeg can decode**, recorded with a pause of at least `--min-silence` between steps.
- **Screenshots** whose numeric filename order is the procedure order.

## Install

```bash
git clone https://github.com/pinklightultra/narration-timed-slideshow
cd narration-timed-slideshow
```

There is no package install. The script uses Node's standard library. `npm link` puts `narration-sync` on your `PATH`. `npm run sync` runs the same file.

ffmpeg, which ships ffprobe:

```bash
winget install Gyan.FFmpeg      # Windows
brew install ffmpeg             # macOS
sudo apt install ffmpeg         # Debian, Ubuntu
```

Then run the smoke test. It synthesizes its own audio and images. It does not need a recording from you.

```bash
node scripts/smoke-test.js
```

`npm run smoke` is the same command.

| Exit | Meaning |
|---|---|
| 0 | Every check passed, including a rendered mp4. |
| 1 | A check failed. |
| 2 | ffmpeg or ffprobe is missing. The checks that do not need ffmpeg still ran. A skip is not a pass, and the script says so. |

## Render

1. Record the narration. Pause between steps. A quiet stretch has to last at least `--min-silence` (default 0.4 s) or it is not a pause. A speech gap of 0.15 s or shorter is dropped even when the silence around it was detected.
2. Put the screenshots in one directory. `shot-1.png`, `shot-2.png`, `shot-10.png` is a valid order. The extensions the script reads are `.png`, `.jpg`, and `.jpeg`.
3. Read the plan. `--dry-run` prints each speech segment, the screenshot order, how long the video would run against the audio, and the concat list. It returns before the encode and writes no mp4.

    ```bash
    node narration-sync.js --audio narration.mp3 --screenshots ./shots --dry-run
    ```

4. Render when the segment count and the file count are the counts you wanted.

    ```bash
    node narration-sync.js --audio narration.mp3 --screenshots ./shots --output out.mp4
    ```

If the whole file is reported as silence, speech sat below the threshold. The error tells you to try `--noise -40` or a shorter `--min-silence`. `-40` is a lower threshold: audio has to be quieter before it counts as silence, so quiet speech is kept, and a pause has to be quieter before it counts.

If pauses in the room tone never appear, the room is louder than the threshold. Move `--noise` toward `-20`, or raise `--min-silence`, and read another dry run. A cough or a filler word inside a pause is speech. It becomes its own segment. `--groups` is how you put that segment back on the screenshot it belongs to.

| Flag | Default | Effect |
|---|---|---|
| `--audio` | required | Narration. Any container ffmpeg decodes. |
| `--screenshots` | required | Directory of `.png`, `.jpg`, `.jpeg`. |
| `--output` | `./output/synced.mp4` | Destination. Parent directories are created. |
| `--groups` | unset | Segments per screenshot, for example `3,2,1,4`. |
| `--noise` | `-30` | Silence threshold in dB. Audio below it is silence. Passed through as `noise=-30dB`. See [Method](#method) for the filter's own default. |
| `--min-silence` | `0.4` | Seconds of quiet before a pause counts. |
| `--lead-in` | `0.15` | Seconds of the following pause kept on the current screenshot. |
| `--width`, `--height` | `1440`, `900` | Frame size. See the scale behavior in [Method](#method). |
| `--dry-run` | off | Print the plan. Write nothing. |
| `--keep-temp` | off | Keep the concat list and the silent mp4 beside the output. |

Narration, screenshots, and rendered video are gitignored. A narration is a voice recording, and it is usually a description of a real system. The ignore rules cover the audio extensions and the image extensions. An earlier copy of this tool ignored `*.mp4` and still committed the wav. [`.gitignore`](.gitignore) is written so that does not happen here.

## When one pause is not one slide

The default pairs segment *i* with screenshot *i*. That matches a take with one pause per screenshot. Three sentences on one screen, then one sentence on the next, is a different take. Count the segments in `--dry-run`, then name the grouping.

```bash
node narration-sync.js --audio narration.mp3 --screenshots ./shots --groups 3,2,1,4
```

The first three segments share screenshot 1, the next two share screenshot 2, then one, then four. `shot-1.png` is still the first file in numeric order. `--groups` changes how long each file is held. It does not change the order.

A sum that does not equal the detected count is refused. `--groups 2,2` against three segments exits 1 and reports that the groups sum to 4 and that 3 segments were detected. Run the dry run, then change the groups or the silence flags. The script will not guess which reading you meant.

## Slideshow Studio

[`slideshow_studio.html`](slideshow_studio.html) is a local preview of the same decision: where the pauses fell, and which picture is up while you listen. It is a second implementation of the detector. The mp4 is still produced by `narration-sync.js`.

```bash
node server.js
```

The process binds to `127.0.0.1` only and prints `http://127.0.0.1:8429`. `--port` changes the port (default 8429). `npm run studio` is the same process. On Windows, [`launch_studio.bat`](launch_studio.bat) opens that URL and then starts the server. Reload the page if the browser arrives first.

In the page:

1. Choose **Load Narration**, or drop an audio file on the window. The waveform is drawn from the decoded buffer.
2. Choose **Load Slides**, or drop images. Names sort with numeric comparison, the same rule as the CLI. The page accepts `.png`, `.jpg`, `.jpeg`, `.webp`, and any other type the browser reports as `image/*`.
3. Move **Noise Floor** (-50 to -15 dB), **Min Silence** (0.20 to 1.50 s), and **Lead-in** (0.05 to 0.40 s). Each change re-detects. Those ranges are the sliders. The CLI accepts any non-negative duration and any numeric dB value, including values the sliders cannot express. **Re-Detect** runs the same pass again. **Auto-Align** remaps pictures onto the current segments. It does not detect silence again.
4. Press **Play**. Space toggles playback. **J** steps to the next segment, **K** to the previous one. The viewport shows the screenshot mapped to the segment under the playhead.
5. **+ Merge** on a segment card folds that card into the next one, in the preview.

Play is the browser playing your audio against the browser's segment list. It is not a playback of the mp4.

**Copy Command**, **Copy --groups**, and **Save Cues** sit under the timeline. Use them as notes. Take the timing you will publish from `--dry-run`. Four things the page shows are properties of the preview. The CLI will not reproduce them.

**The detectors are different code.** The CLI calls ffmpeg `silencedetect` with the noise and duration arguments above, and without `mono=1`, so the filter's default channel mode is what runs. `detectSpeechSegmentsFromBuffer()` measures RMS on channel 0 only, in 40 ms windows, and compares it with `10^(dB/20)`. It then pads each segment by the lead-in on both sides, and it drops a segment whose padded duration is 0.25 s or shorter. The CLI drops a raw speech gap of 0.15 s or shorter, and it applies the lead-in at the end of a hold only. Browser segments can overlap. CLI holds do not.

A 0.10 s gap that does not sit against the start of the file fails the CLI test and is dropped. The same gap in the page, with the default 0.15 s lead-in on both edges, has a padded duration of 0.40 s and is kept. The segment count in the page header is the browser count. The count in `--dry-run` is the count the mp4 uses.

**Merge does not become `--groups`.** `groupsConfig` is filled with a list of ones, and only when the screenshot count equals the segment count. `groupWithNext()` shortens the segment list and calls that function again. After the merge the counts differ, so the list of ones is left as it was. **Copy Command** appends `--groups` only when some stored count is greater than 1. A merge never meets that test, so the command you copy has no `--groups` at all. **Copy --groups** copies the stale list. Its sum is the segment count from before the merge, and the CLI rejects that sum. The copied command also uses the audio file's name, not its path, and the literal directory `./shots`. After a merge, write `--groups` from the CLI's own segment list.

When you do not merge, and you have more segments than screenshots, the page and the CLI do the same thing with the extras: they hold them on the last screenshot. The cuts can still disagree, because the detectors disagree.

**Save Cues downloads `narration-cues.json`, and nothing in this repository reads it.** `narration-sync.js` has no cue-file argument. The JSON is a record of the browser's segments.

**The page never calls the server to render.** `POST /api/render` on [`server.js`](server.js) spawns the CLI with filesystem paths from the JSON body (`audio`, `screenshots`, and optional `output`, `groups`, `noise`, `min_silence`, `lead_in`). The request stays open until the CLI exits. Choosing a file in the browser does not give the server a path, and `slideshow_studio.html` does not send that request. The route is a local trigger for paths already on disk. It does not accept `--width` or `--height`. `GET /api/status` returns JSON with `ok: true`, the app name, and the port.

`.webp` and other non-JPEG/PNG images preview in the page and are ignored by the CLI. A folder that looks populated in the studio can dry-run as an empty directory.

## Tests

[`scripts/smoke-test.js`](scripts/smoke-test.js) is the test. It has two halves, and the exit code refuses to treat the first half as the whole test.

The half that needs no ffmpeg calls the exported functions:

- `naturalSort` orders `shot-1.png`, `shot-2.png`, `shot-10.png`. The same check asserts that a plain `sort()` puts `shot-10.png` second.
- `naturalSort` orders `s-01.png`, `s-02.png`, `s-03.png`.
- `silencesToSpeechSegments` turns silences at 1–2 s and 3–4 s, in a 5 s span, into three segments. The last one runs to the duration.
- A 0.1 s gap does not survive as a segment.
- Silence that covers the whole file yields no segments.
- `applyGroups` with `[2, 1]` merges three segments into two. The first merged segment spans the start of the first input to the end of the second.

The half that needs ffmpeg builds a 6 s tone: 440 Hz for the first second of every 2 s period, silence otherwise. That is three speech stretches and a trailing pause. It writes `shot-1.png`, `shot-2.png`, and `shot-10.png` as solid colors, unpadded on purpose, and runs the real CLI at 320×240. It then requires all of the following: exit 0, a log line reporting 3 speech segments, the printed order `shot-1.png`, `shot-2.png`, `shot-10.png`, an mp4 larger than 1 KB, an `ffprobe` duration within 0.4 s of 6, no truncation warning, deletion of the concat list and the silent video, a `--dry-run` that writes no file, and `--groups 2,2` exiting 1 with stderr that the groups sum to 4 against 3 detected segments.

The test does not decode a frame. A wrong pad, a cropped picture, or the right file held for the wrong interval can pass. The order check reads the log line `naturalSort` printed. It does not read pixels out of the concat file.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request to `main` or `master`, and on manual dispatch. The job installs ffmpeg on `ubuntu-latest` and runs `npm run smoke` on Node 18, 20, and 22.

[![Narration Timed Slideshow CI](https://github.com/pinklightultra/narration-timed-slideshow/actions/workflows/ci.yml/badge.svg)](https://github.com/pinklightultra/narration-timed-slideshow/actions/workflows/ci.yml)

The studio page, `POST /api/render`, and the bytes of a frame are not in that run.

## Limitations

- **Still frames, hard cuts.** One picture per hold, in order. A step that has to show motion needs a recording of the screen.
- **The pauses are the edit.** A filler word, a cough, or room tone on the wrong side of `--noise` changes the segment count. `--dry-run` shows the count this file will use. `--groups` is the correction. Both are manual.
- **A count mismatch warns and renders.** The last screenshot absorbs extra segments. Extra screenshots are dropped from the end, with a warning. That default will publish a video that is missing a step if you do not read the warning.
- **The studio and the CLI do not share a detector, a group list, or a cue file.** The details are in [Slideshow Studio](#slideshow-studio). Listen in the page if it helps you hear the take. Publish from `--dry-run`.
- **Two encodes.** The silent slideshow is encoded, then the mux encodes the video again. On a short procedure the second pass is a short wait. On a long piece it is most of the runtime.
- **Frames are untested.** The smoke test measures process status, log text, duration, file size, and cleanup.
- **The browser page is untested.** Nothing in the smoke test or the workflow loads `slideshow_studio.html` or calls `/api/render`.

## Background

I was writing documentation for a healthcare SaaS platform. The procedures already had screenshots, taken for the article, and each of them also needed a short video. Assembling those on a timeline was the part of the work I wanted to stop doing. Recording the narration in one take, with a pause between steps, was the part I could repeat.

The script started inside a larger capture pipeline that also drove a browser from transcript timestamps. That half was tied to one application. What remained needed a folder, a voice, and ffmpeg.

## License

MIT. See [LICENSE](LICENSE).
