// SVG to PNG for export_matrix_image (format "png"), asked by a customer for Google
// Slides, which does not take SVG. resvg (@resvg/resvg-js) is a prebuilt renderer:
// no native build, no browser. Loaded on first use, so the server starts even where
// its binary is missing; the tool then says PNG is unavailable instead of failing.
// Text: the SVG asks for Helvetica, Arial, sans-serif; the server has Liberation
// Sans (Arial's metrics) on Linux, Arial elsewhere.
//
// The hosted server is one process for every organization: renders run off the main
// thread (renderAsync, libuv pool), the picture is bounded in pixels, and one call
// draws at most MAX_PAGES pages.

let resvg = null;

async function load() {
  if (!resvg) {
    const mod = await import('@resvg/resvg-js');
    resvg = mod.renderAsync ? mod : mod.default;
    if (typeof resvg?.renderAsync !== 'function') throw new Error('renderAsync missing');
  }
  return resvg;
}

// Wide enough for a projector, small enough for a tool result and the server's memory.
const MAX_WIDTH = 2400;
const MAX_PIXELS = 12_000_000;
export const MAX_PAGES = 12;

const dimension = (svg, name) => Number(new RegExp(`<svg[^>]*\\s${name}="(\\d+(?:\\.\\d+)?)"`).exec(svg)?.[1]) || 0;

/** The zoom a picture is drawn at: twice its size, within the width and pixel caps; 0 if even 1:1 is too big. */
export function zoomFor(svg) {
  const width = dimension(svg, 'width') || 1200;
  const height = dimension(svg, 'height') || 900;
  const zoom = Math.min(2, MAX_WIDTH / width, Math.sqrt(MAX_PIXELS / (width * height)));
  return zoom >= 0.5 ? zoom : 0;
}

/** PNG bytes of `svg`; throws TOO_LARGE when it cannot be drawn within the caps. */
export async function svgToPng(svg) {
  const zoom = zoomFor(svg);
  if (!zoom) throw Object.assign(new Error('TOO_LARGE'), { code: 'TOO_LARGE' });
  const { renderAsync } = await load();
  const image = await renderAsync(svg, {
    fitTo: { mode: 'zoom', value: zoom },
    background: '#ffffff',
    font: { loadSystemFonts: true, defaultFontFamily: process.platform === 'linux' ? 'Liberation Sans' : 'Arial' },
  });
  return image.asPng();
}

/**
 * An export_matrix_image result turned to PNG: the SVG text leaves the result,
 * each picture becomes an image the client can show and save. { error } when the
 * renderer is not there or the matrix is too large to draw as a picture.
 */
export async function asPng(result) {
  if (!result || result.error) return result;
  try {
    const { svg, pages, ...rest } = result;
    const drawn = (pages ?? []).slice(0, MAX_PAGES);
    const images = [];
    if (typeof svg === 'string') images.push({ data: (await svgToPng(svg)).toString('base64') });
    for (const page of drawn) images.push({ data: (await svgToPng(page.svg)).toString('base64') });
    const left = (pages?.length ?? 0) - drawn.length;
    return {
      ...rest,
      mediaType: 'image/png',
      filename: rest.filename.replace(/\.svg$/, '.png'),
      ...(pages && { pages: drawn.map((p) => ({ elementId: p.elementId, title: p.title, filename: p.filename.replace(/\.svg$/, '.png') })) }),
      ...(left > 0 && { pagesLeftOut: left }),
      note:
        'The PNG pictures follow as images, in this order: save them as files (one per page with layout "initiatives"). Google Slides and every other tool take them.' +
        (left > 0 ? ` Only the first ${MAX_PAGES} pages are drawn as PNG; format "svg" gives all of them.` : ''),
      images,
    };
  } catch (error) {
    if (error?.code === 'TOO_LARGE') {
      return { error: 'This matrix is too large to draw as a PNG picture: ask for format "svg", which has no size limit.' };
    }
    // The detail (a native module path, say) stays in the server log.
    console.error('png export failed:', error?.message);
    return { error: 'PNG is not available on this server right now: ask for format "svg", or use the Image button of the matrix in the app.' };
  }
}
