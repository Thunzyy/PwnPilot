/**
 * Image preview widget for Live Preview.
 *
 * Renders actual images below image syntax lines as block widgets.
 * Supports standard markdown images ![alt](url) and wikilink images
 * ![[image.png]]. When the cursor is on the image line, raw markdown
 * is shown. When the cursor moves away, the image preview appears.
 *
 * This widget is rendered by a StateField (imageField.ts), NOT the
 * ViewPlugin, because block widgets are height-changing decorations
 * that require StateField-based provision (Pitfall P2).
 */
import { WidgetType } from "@codemirror/view";

/**
 * Block widget that renders an image preview below the syntax line.
 *
 * Creates an img element with loading skeleton and error states.
 * Uses browser-native lazy loading (no IntersectionObserver needed).
 */
export class ImagePreviewWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImagePreviewWidget): boolean {
    return this.url === other.url && this.alt === other.alt;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-lp-image-wrapper cm-lp-image-loading";

    const img = document.createElement("img");
    img.className = "cm-lp-image";
    img.src = this.url;
    img.alt = this.alt;
    img.loading = "lazy";

    img.addEventListener("load", () => {
      wrapper.classList.remove("cm-lp-image-loading");
      wrapper.classList.add("cm-lp-image-loaded");
    });

    img.addEventListener("error", () => {
      wrapper.classList.remove("cm-lp-image-loading");
      wrapper.classList.add("cm-lp-image-error");
      img.style.display = "none";

      const errorText = document.createElement("span");
      errorText.className = "cm-lp-image-error-text";
      errorText.textContent = "Image not found";
      wrapper.appendChild(errorText);
    });

    wrapper.appendChild(img);
    return wrapper;
  }

  get estimatedHeight(): number {
    return 200;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
