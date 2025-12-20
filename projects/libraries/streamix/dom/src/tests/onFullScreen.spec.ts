import { scheduler } from "@actioncrew/streamix";

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
  await Promise.resolve();
}

function fullscreenAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    !!document.documentElement?.requestFullscreen
  );
}

async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  try {
    await el.requestFullscreen();
    return document.fullscreenElement === el;
  } catch {
    return false;
  }
}

async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}

/* -------------------------------------------------- */
/* Browser-only tests                                 */
/* -------------------------------------------------- */

describe("onFullscreen", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    el.style.width = "10px";
    el.style.height = "10px";
    document.body.appendChild(el);
  });

  afterEach(async () => {
    await exitFullscreen();
    el.remove();
    await flush();
  });

  /* ---------------------------------------------- */
  /* Guards                                          */
  /* ---------------------------------------------- */

  it("runs only when Fullscreen API is available", () => {
    expect(fullscreenAvailable()).toBeTrue();
  });
});
