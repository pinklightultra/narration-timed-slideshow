# narration-timed-slideshow

`narration-sync` builds an mp4 that holds a folder of screenshots under a narration you record yourself, for a technical writer who already captured those frames for the article and needs the same frames in a short video.

The cuts come from the pauses. A screenshot stays up through the speech for its step and through a short lead-in after that speech. The last screenshot stays up through whatever silence the take ends on. You bring an audio file and a directory of images. ffmpeg finds the silences. Node pairs them with the files. There are no npm dependencies, and this repository is not published to npm.

## Requirements

- **Node.js** `>=16`, as `package.json` declares. [The workflow](.github/workflows/ci.yml) runs the smoke test on 18, 20, and 22. Node 16 is the declared floor. It is not one of the versions the workflow installs.
- **ffmpeg and ffprobe on `PATH`.** `requireBinaries()` checks both before it reads the audio. The error names the install command.
- **A narration ffmpeg can decode**, with a pause of at least `--min-silence` (default 0.4 s) between steps.
- **Screenshots** whose numeric filename order is the procedure order. The script reads `.png`, `.jpg`, and `.jpeg`.

## Quickstart

```bash
git clone https://github.com/pinklightultra/narration-timed-slideshow
cd narration-timed-slideshow
```

There is no package install. The script uses Node's standard library. `npm run sync` runs [`narration-sync.js`](narration-sync.js). Pass flags after `--`.

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

`npm run smoke` is the same command. A clean run ends with `14 passed, 0 failed, 0 skipped.`

Smoke-test exits:

| Exit | Meaning |
|---|---|
| 0 | Every check passed, including a rendered mp4. |
| 1 | A check failed. |
| 2 | ffmpeg or ffprobe is missing. The checks that do not need ffmpeg still ran. A skip is not a pass, and the script says so. |

## Render

1. Record the narration. Pause between steps. A quiet stretch has to last at least `--min-silence` (default 0.4 s) or it is not a pause. A speech gap of 0.15 s or shorter is dropped even when the silence around it was detected.
2. Put the screenshots in one directory. `shot-1.png`, `shot-2.png`, `shot-10.png` is a valid order.
3. Read the plan. `--dry-run` prints each speech segment, the screenshot order, how long the video would run against the audio, and the concat list. It returns before the encode and writes no mp4.

    ```bash
    node narration-sync.js --audio narration.mp3 --screenshots ./shots --dry-run
    ```

4. Render when the segment count and the file count are the counts you wanted.

    ```bash
    node narration-sync.js --audio narration.mp3 --screenshots ./shots --output out.mp4
    ```

The default output path, when you omit `--output`, is `./output/synced.mp4`. Parent directories are created.

If the whole file is reported as silence, speech sat below the threshold. The error tells you to try `--noise -40` or a shorter `--min-silence`. `-40` is a lower threshold: audio has to be quieter before it counts as silence, so quiet speech is kept, and a pause has to be quieter before it counts.

If pauses in the room tone never appear, the room is louder than the threshold. Move `--noise` toward `-20`, or raise `--min-silence`, and read another dry run. A cough or a filler word inside a pause is speech. It becomes its own segment. `--groups` is how you put that segment back on the screenshot it belongs to.

| Flag | Default | Effect |
|---|---|---|
| `--audio` | required | Narration. Any container ffmpeg decodes. |
| `--screenshots` | required | Directory of `.png`, `.jpg`, `.jpeg`. |
| `--output` | `./output/synced.mp4` | Destination. Parent directories are created. |
| `--groups` | unset | Segments per screenshot, for example `3,2,1,4`. |
| `--noise` | `-30` | Silence threshold in dB. Audio below it is silence. Passed through as `noise=-30dB`. The filter's own default is different. See [How a hold is timed](docs/timing.md). |
| `--min-silence` | `0.4` | Seconds of quiet before a pause counts. |
| `--lead-in` | `0.15` | Seconds of the following pause kept on the current screenshot. |
| `--width`, `--height` | `1440`, `900` | Frame size. The picture is fitted inside the frame and padded. It is not cropped. |
| `--dry-run` | off | Print the plan. Write nothing. |
| `--keep-temp` | off | Keep `<output>.concat.txt` and `<output>.silent.mp4` beside the output. |

Render exits:

| Exit | Meaning |
|---|---|
| 0 | The mux finished. A screenshot-count mismatch is a warning on this same exit. It does not fail the process. |
| 1 | Bad arguments, a missing file, ffmpeg or ffprobe missing, no speech detected, or `--groups` does not sum to the segment count. |
| 2 | The mp4 was written, and the end of the narration was trimmed by more than 0.25 s. The warning names the number of seconds. |

Narration, screenshots, and rendered video are gitignored. A voice recording does not belong in this repository. The longer note is in [`.gitignore`](.gitignore).

## Example

This is a real dry run of the smoke test's fixture: a 6 s tone with sound on the first second of every 2 s, and `shot-1.png`, `shot-2.png`, `shot-10.png`, at 320×240, on ffmpeg 6.1.1. The `file` lines were absolute paths from `path.resolve`. The directory in those lines is the only text changed below.

```text
narration-sync: screenshots timed to speech segments
  audio:       narration.wav (6.0s)
  screenshots: ./shots
  noise floor: -30dB, min silence: 0.4s, lead-in: 0.15s

3 silences -> 3 speech segments:
  [0] 0.00s - 1.00s  (1.00s)
  [1] 2.00s - 3.00s  (1.00s)
  [2] 4.00s - 5.00s  (1.00s)

3 screenshots, in this order:
  [0] shot-1.png
  [1] shot-2.png
  [2] shot-10.png

Video would run 6.00s against 6.00s of audio.
--dry-run: stopping before ffmpeg. Concat list:

file '<absolute path>/shot-1.png'
duration 1.150
file '<absolute path>/shot-2.png'
duration 2.000
file '<absolute path>/shot-10.png'
duration 2.850
file '<absolute path>/shot-10.png'
```

The last `file` line is repeated with no duration. The concat demuxer ignores a trailing duration unless the file is listed once more.

The render of that same fixture printed:

```text
Done.
  file:     <absolute path>/out.mp4
  size:     0.1 MB
  duration: 6.0s  (audio 6.0s, video 4.4s)
```

`0.1 MB` is this 320×240 run, not a 1440×900 one. Read the first duration, `6.0s`. That is the muxed file. `audio` is the source. `video` is the container duration of the silent intermediate, which is variable frame rate, measured before the mux. On this run that intermediate was 4.4 s and the muxed file was 6.0 s. The process exited 0. The truncation warning did not fire. The timestamps behind that 4.4 s figure are in [How a hold is timed](docs/timing.md).

## When one pause is not one slide

The default pairs segment *i* with screenshot *i*. That matches a take with one pause per screenshot. Three sentences on one screen, then one sentence on the next, is a different take. Count the segments in `--dry-run`, then name the grouping.

```bash
node narration-sync.js --audio narration.mp3 --screenshots ./shots --groups 3,2,1,4
```

The first three segments share screenshot 1, the next two share screenshot 2, then one, then four. `shot-1.png` is still the first file in numeric order. `--groups` changes how long each file is held. It does not change the order.

A sum that does not equal the detected count is refused. On the 6 s fixture above, `--groups 2,2` exited 1. The error, on stderr, was:

```text
--groups sums to 4 but 3 segments were detected.
They must match exactly. Run with --dry-run to see the detected segments, then either
adjust --groups or loosen --noise / --min-silence.
```

The script will not guess which reading you meant.

## Slideshow Studio

[`slideshow_studio.html`](slideshow_studio.html) is a local preview of where the pauses fell, and which picture is up while you listen. It is a second implementation of the detector. The mp4 is still produced by `narration-sync.js`.

```bash
node server.js
```

The process binds to `127.0.0.1` only and prints `http://127.0.0.1:8429`. `--port` changes the port (default 8429). `npm run studio` is the same process. On Windows, [`launch_studio.bat`](launch_studio.bat) opens that URL and then starts the server. Reload the page if the browser arrives first.

In the page: load a narration and the screenshots, move Noise Floor, Min Silence, and Lead-in, and press Play. Space toggles playback. **J** steps to the next segment, **K** to the previous one. **Copy Command**, **Copy --groups**, and **Save Cues** are notes. Take the timing you will publish from `--dry-run`.

The page does not call ffmpeg. After **+ Merge**, **Copy --groups** still has the counts from before the merge. Write `--groups` from a CLI dry run. `.webp` previews in the page and is ignored by the CLI. The differences are in [Slideshow Studio](docs/slideshow-studio.md).

## Tests

[`scripts/smoke-test.js`](scripts/smoke-test.js) is the test. The half that needs no ffmpeg checks ordering, silence inversion, and grouping. The half that needs ffmpeg renders the fixture in the example above and checks the log, the duration, the cleanup, `--dry-run`, and a bad `--groups`. What it does not check is in [Tests](docs/tests.md).

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request to `main` or `master`, and on manual dispatch. The job installs ffmpeg on `ubuntu-latest` and runs `npm run smoke` on Node 18, 20, and 22.

[![Narration Timed Slideshow CI](https://github.com/pinklightultra/narration-timed-slideshow/actions/workflows/ci.yml/badge.svg)](https://github.com/pinklightultra/narration-timed-slideshow/actions/workflows/ci.yml)

## Limitations

- **Still frames, hard cuts.** One picture per hold, in order. A step that has to show motion needs a recording of the screen.
- **The pauses are the edit.** A filler word, a cough, or room tone on the wrong side of `--noise` changes the segment count. `--dry-run` shows the count this file will use. `--groups` is the correction. Both are manual.
- **A count mismatch warns and renders.** The last screenshot absorbs extra segments. Extra screenshots are dropped from the end, with a warning. That default will publish a video that is missing a step if you do not read the warning.
- **The studio and the CLI do not share a detector, a group list, or a cue file.** Listen in the page if it helps you hear the take. Publish from `--dry-run`. See [Slideshow Studio](docs/slideshow-studio.md).
- **Two encodes.** The silent slideshow is encoded, then the mux encodes the video again. On a short procedure the second pass is a short wait. On a long piece it is most of the runtime.
- **Frames are untested.** The smoke test measures process status, log text, duration, file size, and cleanup. It does not decode a frame.
- **The browser page is untested.** Nothing in the smoke test or the workflow loads `slideshow_studio.html` or calls `/api/render`.

## Background

I was writing documentation for a healthcare SaaS platform. The procedures already had screenshots, taken for the article, and each of them also needed a short video. Assembling those on a timeline was the part of the work I wanted to stop doing. Recording the narration in one take, with a pause between steps, was the part I could repeat.

The script started inside a larger capture pipeline that also drove a browser from transcript timestamps. That half was tied to one application. What remained needed a folder, a voice, and ffmpeg.

## License

MIT. See [LICENSE](LICENSE).

## Reference

- [How a hold is timed](docs/timing.md) — silence detection, the hold arithmetic, and the duration line
- [Slideshow Studio](docs/slideshow-studio.md) — what the page does, and what the CLI will not reproduce
- [Tests](docs/tests.md) — each smoke-test check, and what a green run does not prove
