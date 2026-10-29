// Encodes a video (video.js) in the browser with WebCodecs: H.264 MP4 where the browser can encode
// it (Chrome, Edge, Safari), otherwise VP9 WebM. Nothing is uploaded anywhere.

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from 'mediabunny';

export const canExportVideo = () => typeof VideoEncoder !== 'undefined';

/**
 * opts.onProgress(fraction), opts.signal (AbortSignal).
 * Resolves to { blob, type, extension }.
 */
export async function exportVideo(video, opts = {}) {
  if (!canExportVideo()) throw new Error("This browser can't make videos. Try Chrome, Edge or Safari.");
  const { width, height, fps, frames } = video;
  const size = { width, height, frameRate: fps };
  let codec = null, Format = null, type = '', extension = '';
  if (await canEncodeVideo('avc', size)) [codec, Format, type, extension] = ['avc', Mp4OutputFormat, 'video/mp4', 'mp4'];
  else if (await canEncodeVideo('vp9', size)) [codec, Format, type, extension] = ['vp9', WebMOutputFormat, 'video/webm', 'webm'];
  else throw new Error("This browser can't encode video at this size. Try Chrome, Edge or Safari.");

  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  const output = new Output({
    format: Format === Mp4OutputFormat ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      video.draw(ctx, i);
      await source.add(i / fps, 1 / fps);
      if (i % 10 === 0) {
        opts.onProgress?.(i / frames);
        // let the page repaint so a progress bar can move
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
  opts.onProgress?.(1);
  return { blob: new Blob([output.target.buffer], { type }), type, extension };
}

/** Saves a blob as a file download. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
