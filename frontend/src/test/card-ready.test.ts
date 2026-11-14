/**
 * The card-readiness stubs (`./card-ready.ts`), pinned against plain DOM, so a
 * red test in a feature folder points at the feature rather than at a stub
 * that never fired.
 */
import { describe, expect, it, vi } from "vitest";

import { stubImages, stubIntersectionObserver } from "./card-ready";

const URL_A = "https://media.test.invalid/media/1/full.jpg";
const URL_B = "https://media.test.invalid/media/2/full.jpg";

describe("stubImages", () => {
  it("stalls by default: no load, no error, decode() pending", async () => {
    const images = stubImages();
    const image = new Image();
    const heard = vi.fn();
    image.onload = heard;
    image.onerror = heard;
    image.src = URL_A;
    let decoded = false;
    void image.decode().then(() => (decoded = true));

    await Promise.resolve();

    expect(images.wasRequested(URL_A)).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    expect(decoded).toBe(false);
    expect(image.complete).toBe(false);
  });

  it("loads one URL at a time: load fires and decode() resolves", async () => {
    const images = stubImages();
    const a = new Image();
    const b = new Image();
    const onLoad = vi.fn();
    a.addEventListener("load", onLoad);
    a.src = URL_A;
    b.src = URL_B;
    const decoding = a.decode();

    await images.load(URL_A);

    await expect(decoding).resolves.toBeUndefined();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(a.complete).toBe(true);
    expect(b.complete).toBe(false);
  });

  it("fails a URL: error fires and decode() rejects", async () => {
    const images = stubImages();
    const image = new Image();
    const onError = vi.fn();
    image.onerror = onError;
    image.src = URL_A;
    // Caught before the URL settles, as the code under test would.
    const decoding = image.decode().then(
      () => "resolved",
      (error: unknown) => error,
    );

    await images.fail(URL_A);

    expect(await decoding).toBeInstanceOf(DOMException);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("loads but cannot decode: load fires and decode() rejects", async () => {
    const images = stubImages();
    const image = new Image();
    const onLoad = vi.fn();
    image.onload = onLoad;
    image.src = URL_A;
    const decoding = image.decode().then(
      () => "resolved",
      (error: unknown) => error,
    );

    await images.loadUndecodable(URL_A);

    expect(await decoding).toBeInstanceOf(DOMException);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("tracks an <img> given its src as an attribute, and counts elements", async () => {
    const images = stubImages();
    const image = document.createElement("img");
    image.setAttribute("src", URL_A);
    new Image().src = URL_A;

    expect(images.requested).toEqual([URL_A]);
    expect(images.requestCount(URL_A)).toBe(2);
  });

  it("answers an element pointed at an already loaded URL, as from cache", async () => {
    const images = stubImages();
    new Image().src = URL_A;
    await images.load(URL_A);

    const later = new Image();
    const onLoad = vi.fn();
    later.onload = onLoad;
    later.src = URL_A;

    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await expect(later.decode()).resolves.toBeUndefined();
  });

  it("autoLoad loads every URL a tick after it is requested", async () => {
    stubImages({ autoLoad: true });
    const image = new Image();
    image.src = URL_B;

    await expect(image.decode()).resolves.toBeUndefined();
  });
});

describe("stubIntersectionObserver", () => {
  it("records each observer's options and what it observes", () => {
    const io = stubIntersectionObserver();
    const target = document.createElement("div");
    document.body.append(target);
    const observer = new IntersectionObserver(() => {}, {
      rootMargin: "0px 0px 100% 0px",
    });
    observer.observe(target);

    expect(io.observers).toHaveLength(1);
    expect(io.observers[0].options.rootMargin).toBe("0px 0px 100% 0px");
    expect(io.observed()).toEqual([target]);
    target.remove();
  });

  it("tells only the observers watching an element inside or around the one entered", async () => {
    const io = stubIntersectionObserver();
    const item = document.createElement("li");
    const card = document.createElement("div");
    const other = document.createElement("div");
    item.append(card);
    document.body.append(item, other);
    const seen: [Element, boolean][] = [];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries)
        seen.push([entry.target, entry.isIntersecting]);
    });
    observer.observe(card);
    observer.observe(other);

    await io.enter(item);
    await io.leave(item);

    expect(seen).toEqual([
      [card, true],
      [card, false],
    ]);
    item.remove();
    other.remove();
  });

  it("intersectAll reports every element as intersecting when it is observed", () => {
    stubIntersectionObserver({ intersectAll: true });
    const target = document.createElement("div");
    const callback = vi.fn();
    new IntersectionObserver(callback).observe(target);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0][0]).toMatchObject({
      target,
      isIntersecting: true,
    });
  });

  it("removes the global again once the test is over", () => {
    expect("IntersectionObserver" in window).toBe(false);
    expect(typeof HTMLImageElement.prototype.decode).not.toBe("function");
  });
});
