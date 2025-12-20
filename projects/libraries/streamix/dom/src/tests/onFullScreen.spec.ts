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
