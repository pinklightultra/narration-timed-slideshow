#!/usr/bin/env node
/**
 * narration-sync.js -- time a folder of screenshots to a recorded narration.
 *
 * You record yourself talking through a procedure, pausing between steps. This finds those
 * pauses with ffmpeg's silencedetect filter, treats the speech between them as one segment per
 * step, and holds one screenshot for each. No cue files, no timeline editor, no browser
 * automation: record audio, point at a folder, get an mp4.
 *
 * The assumption it rests on is that your pauses line up with your slide changes. When they do
 * not -- three sentences about one screen, then one about the next -- pass --groups to say so.
 *
 * Usage:
 *   node narration-sync.js --audio narration.mp3 --screenshots ./shots --output out.mp4
 *   node narration-sync.js --audio narration.mp3 --screenshots ./shots --groups 3,2,1,4
 *   node narration-sync.js --audio narration.mp3 --screenshots ./shots --noise -30 --min-silence 0.4
 *   node narration-sync.js --dry-run --audio narration.mp3 --screenshots ./shots
 *
 * Requires ffmpeg and ffprobe on PATH. Nothing else: no npm dependencies, no network, no API.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

const audioPath = get('--audio');
const screenshotsDir = get('--screenshots');
const outputPath = get('--output');
const noiseDb = get('--noise', '-30');
const minSilence = Number(get('--min-silence', '0.4'));
const leadIn = Number(get('--lead-in', '0.15')); // buffer after each cut so words are not clipped
const groupsArg = get('--groups', null);
const dryRun = has('--dry-run');
const keepTemp = has('--keep-temp');

const WIDTH = Number(get('--width', '1440'));
const HEIGHT = Number(get('--height', '900'));

function die(msg) { console.error(msg); process.exit(1); }

/** Validate CLI input. Inside a function, not at module scope, so require() has no side effects. */
function validateArgs() {
  if (!audioPath || !screenshotsDir) {
    console.error('Usage: node narration-sync.js --audio <file> --screenshots <dir> [--output <file.mp4>]');
    console.error('Options: --groups 3,2,1  --noise -30  --min-silence 0.4  --lead-in 0.15');
    console.error('         --width 1440  --height 900  --dry-run  --keep-temp');
    process.exit(1);
  }
  if (!fs.existsSync(audioPath)) die(`Audio not found: ${audioPath}`);
  if (!fs.existsSync(screenshotsDir)) die(`Screenshots dir not found: ${screenshotsDir}`);
  for (const [flag, val] of [['--min-silence', minSilence], ['--lead-in', leadIn],
                             ['--width', WIDTH], ['--height', HEIGHT]]) {
    if (!Number.isFinite(val) || val < 0) die(`${flag} must be a non-negative number, got: ${val}`);
  }
  if (!/^-?\d+(\.\d+)?$/.test(String(noiseDb))) {
    die(`--noise must be a number of dB, e.g. -30. Got: ${noiseDb}`);
  }
}

/**
 * Both binaries, checked before anything else runs.
 *
 * Without this the first failure is an ENOENT from deep inside execFileSync, which reads like a
 * bug in this script rather than a missing dependency. ffmpeg is the one thing here that is not
 * bundled, cannot be npm-installed, and is absent from a stock Windows machine, so it is the
 * single most likely reason a first run fails.
 */
function requireBinaries() {
  const missing = [];
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const probe = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
    if (probe.error || probe.status !== 0) missing.push(bin);
  }
  if (missing.length) {
    console.error(`Not found on PATH: ${missing.join(', ')}`);
    console.error('Install ffmpeg (it ships ffprobe too) and make sure both are on PATH:');
    console.error('  Windows:  winget install Gyan.FFmpeg');
    console.error('  macOS:    brew install ffmpeg');
    console.error('  Debian:   sudo apt install ffmpeg');
    process.exit(1);
  }
}

function duration(filePath) {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { encoding: 'utf-8' });
  const d = Number(out.trim());
  // ffprobe prints "N/A" for a container it cannot measure, and an empty string for one it
  // cannot open. Both parse to NaN, which would otherwise propagate silently: every segment
  // boundary becomes NaN, the concat file fills with "duration NaN", and ffmpeg renders a
  // zero-length video while every log line above it looked fine.
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe could not read a duration from ${filePath} (got ${JSON.stringify(out.trim())})`);
  }
  return d;
}

/** Run ffmpeg, surfacing its stderr on failure instead of swallowing it. */
function ffmpeg(argv, label) {
  const res = spawnSync('ffmpeg', argv, { encoding: 'utf-8' });
  if (res.error) throw new Error(`${label}: could not run ffmpeg: ${res.error.message}`);
  if (res.status !== 0) {
    // ffmpeg's diagnosis is the last few stderr lines. Piping and discarding them is why a
    // failed render usually reads as an unexplained non-zero exit.
    const tail = (res.stderr || '').trim().split('\n').slice(-12).join('\n');
    throw new Error(`${label}: ffmpeg exited ${res.status}\n${tail}`);
  }
}

// -------- 1. Detect silence --------
function detectSilences(audio, noise, minDur) {
  const res = spawnSync('ffmpeg', [
    '-i', audio, '-af', `silencedetect=noise=${noise}dB:d=${minDur}`, '-f', 'null', '-',
  ], { encoding: 'utf-8' });
  if (res.error) throw new Error(`could not run ffmpeg: ${res.error.message}`);
  // silencedetect logs to stderr, and ffmpeg exits non-zero for reasons unrelated to the
  // filter, so the log is parsed regardless of status. But a status failure with NO
  // silencedetect output at all means the input was never decoded, which must not read as
  // "no silences were found".
  const out = (res.stderr || '') + (res.stdout || '');
  if (!/silencedetect/.test(out) && res.status !== 0) {
    const tail = (res.stderr || '').trim().split('\n').slice(-12).join('\n');
    throw new Error(`ffmpeg could not decode ${audio} (exit ${res.status})\n${tail}`);
  }
  const silences = [];
  let curStart = null;
  out.split('\n').forEach((line) => {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { curStart = Number(s[1]); return; }
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (e && curStart !== null) {
      silences.push({ start: curStart, end: Number(e[1]) });
      curStart = null;
    }
  });
  return silences;
}

// -------- 2. Invert silences into speech segments --------
function silencesToSpeechSegments(silences, totalDuration) {
  const segments = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) segments.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < totalDuration) segments.push({ start: cursor, end: totalDuration });
  // Anything this short is a click or a breath, not a step.
  return segments.filter((seg) => (seg.end - seg.start) > 0.15);
}

/** Collapse consecutive segments per --groups, one merged segment per screenshot. */
function applyGroups(segments, groupCounts) {
  const total = groupCounts.reduce((a, b) => a + b, 0);
  if (total !== segments.length) {
    die(`--groups sums to ${total} but ${segments.length} segments were detected.\n`
      + 'They must match exactly. Run with --dry-run to see the detected segments, then either\n'
      + 'adjust --groups or loosen --noise / --min-silence.');
  }
  const merged = [];
  let idx = 0;
  for (const count of groupCounts) {
    const slice = segments.slice(idx, idx + count);
    merged.push({ start: slice[0].start, end: slice[slice.length - 1].end });
    idx += count;
  }
  return merged;
}

/**
 * Sort filenames the way a human numbers them, so shot-2 precedes shot-10.
 *
 * A plain .sort() is lexicographic, which orders shot-1, shot-10, shot-2. That produces a video
 * with the steps in the wrong order and no error anywhere, which is the worst available outcome:
 * the run reports success and the artifact is silently wrong. Zero-padded names happen to sort
 * correctly either way, which is exactly why the bug survives a first test.
 */
function naturalSort(names) {
  return names.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function main() {
  validateArgs();
  requireBinaries();

  const audioDuration = duration(audioPath);
  console.log('narration-sync: screenshots timed to speech segments');
  console.log(`  audio:       ${audioPath} (${audioDuration.toFixed(1)}s)`);
  console.log(`  screenshots: ${screenshotsDir}`);
  console.log(`  noise floor: ${noiseDb}dB, min silence: ${minSilence}s, lead-in: ${leadIn}s`);
  console.log('');

  const silences = detectSilences(audioPath, noiseDb, minSilence);
  let segments = silencesToSpeechSegments(silences, audioDuration);

  if (!segments.length) {
    die('No speech segments detected. The whole file registered as silence.\n'
      + `Try a lower noise floor (--noise -40) or a shorter --min-silence than ${minSilence}.`);
  }

  console.log(`${silences.length} silences -> ${segments.length} speech segments:`);
  segments.forEach((seg, i) => {
    console.log(`  [${i}] ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s  (${(seg.end - seg.start).toFixed(2)}s)`);
  });
  console.log('');

  if (groupsArg) {
    const groupCounts = groupsArg.split(',').map((n) => Number(n.trim()));
    if (!groupCounts.length || groupCounts.some((n) => !Number.isInteger(n) || n < 1)) {
      die('--groups must be positive integers, e.g. --groups 3,2,1,4');
    }
    segments = applyGroups(segments, groupCounts);
    console.log(`--groups ${groupsArg} -> ${segments.length} merged segments:`);
    segments.forEach((seg, i) => {
      console.log(`  [${i}] ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s  (${(seg.end - seg.start).toFixed(2)}s)`);
    });
    console.log('');
  }

  const screenshots = naturalSort(
    fs.readdirSync(screenshotsDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
  );
  if (!screenshots.length) die(`No .png/.jpg/.jpeg files in ${screenshotsDir}`);

  console.log(`${screenshots.length} screenshots, in this order:`);
  screenshots.forEach((f, i) => console.log(`  [${i}] ${f}`));
  console.log('');

  if (segments.length !== screenshots.length) {
    console.warn(`Segment count (${segments.length}) does not match screenshot count (${screenshots.length}).`);
    console.warn(segments.length > screenshots.length
      ? '  The extra segments will hold on the last screenshot.'
      : `  ${screenshots.length - segments.length} screenshot(s) at the end will be DROPPED.`);
    console.warn('  If that is not what you want, use --groups.');
    console.log('');
  }

  // -------- 3. Map segments to screenshots, build the concat list --------
  const concatLines = [];
  let coveredUntil = 0;
  segments.forEach((seg, i) => {
    const file = path.resolve(screenshotsDir, screenshots[Math.min(i, screenshots.length - 1)]);
    // Each hold runs to the end of its segment plus the lead-in, measured from where the
    // previous hold stopped. Silence is therefore absorbed into the preceding screenshot
    // rather than showing a blank frame.
    //
    // The last hold also runs to the end of the audio. Recordings almost always end with a
    // beat of silence after the final word, and without this the video stops short, -shortest
    // trims the audio to match, and the tail of the narration is cut off every single run.
    const isLast = i === segments.length - 1;
    const holdUntil = isLast ? Math.max(seg.end + leadIn, audioDuration) : seg.end + leadIn;
    const dur = Math.max(0.3, holdUntil - coveredUntil);
    concatLines.push(`file '${file.replace(/'/g, "'\\''")}'`);
    concatLines.push(`duration ${dur.toFixed(3)}`);
    coveredUntil += dur;
  });
  // The concat demuxer ignores the final "duration" unless the file is listed once more.
  const lastIdx = Math.min(segments.length - 1, screenshots.length - 1);
  concatLines.push(`file '${path.resolve(screenshotsDir, screenshots[lastIdx]).replace(/'/g, "'\\''")}'`);

  if (dryRun) {
    console.log(`Video would run ${coveredUntil.toFixed(2)}s against ${audioDuration.toFixed(2)}s of audio.`);
    console.log('--dry-run: stopping before ffmpeg. Concat list:\n');
    console.log(concatLines.join('\n'));
    return;
  }

  const outFile = path.resolve(outputPath || path.join(process.cwd(), 'output', 'synced.mp4'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // Temporaries sit beside the output, so --keep-temp leaves them somewhere findable.
  const concatFile = `${outFile}.concat.txt`;
  const silentVideo = `${outFile}.silent.mp4`;

  try {
    fs.writeFileSync(concatFile, concatLines.join('\n'));

    console.log('Rendering silent slideshow...');
    ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vsync', 'vfr', '-pix_fmt', 'yuv420p',
      '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,`
           + `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
      silentVideo], 'render');

    const videoDuration = duration(silentVideo);

    console.log('Muxing narration onto the slideshow...');
    ffmpeg(['-y', '-i', silentVideo, '-i', audioPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', outFile], 'mux');

    const finalDur = duration(outFile);
    const sizeMb = (fs.statSync(outFile).size / 1048576).toFixed(1);

    console.log('');
    console.log('Done.');
    console.log(`  file:     ${outFile}`);
    console.log(`  size:     ${sizeMb} MB`);
    console.log(`  duration: ${finalDur.toFixed(1)}s  (audio ${audioDuration.toFixed(1)}s, video ${videoDuration.toFixed(1)}s)`);

    // -shortest cuts whichever stream is longer, and when that is the audio it silently drops
    // the end of the narration. That is not something to discover on playback, and the tool is
    // the only thing positioned to notice, so it measures rather than assumes.
    const lost = audioDuration - finalDur;
    if (lost > 0.25) {
      console.warn('');
      console.warn(`WARNING: the last ${lost.toFixed(2)}s of narration is NOT in the output.`);
      console.warn('The slideshow was shorter than the audio, and -shortest cut the audio to match.');
      console.warn('Add a screenshot, or raise --lead-in, so the video covers the full narration.');
      process.exitCode = 2;
    }
  } finally {
    // finally, not a happy-path unlink: a failed mux otherwise leaves a multi-megabyte
    // .silent.mp4 next to the output with nothing saying what it is.
    if (!keepTemp) {
      for (const f of [concatFile, silentVideo]) fs.rmSync(f, { force: true });
    } else {
      console.log(`--keep-temp: left ${path.basename(concatFile)} and ${path.basename(silentVideo)}`);
    }
  }
}

// The pure functions are exported so scripts/smoke-test.js can check them directly, without
// needing an audio file to exercise the ordering and grouping logic.
module.exports = { silencesToSpeechSegments, applyGroups, naturalSort, detectSilences, duration };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`\nFailed: ${e.message}`);
    process.exit(1);
  }
}
