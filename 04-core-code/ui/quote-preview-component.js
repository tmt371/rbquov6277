// File: 04-core-code/ui/quote-preview-component.js

import { EVENTS } from '../config/constants.js';

/**
 * @fileoverview A component to manage the full-screen quote preview overlay.
 */
export class QuotePreviewComponent {
    constructor({ containerElement, eventAggregator }) {
        if (!containerElement || !eventAggregator) {
            throw new Error("Container element and event aggregator are required for QuotePreviewComponent.");
        }
        this.container = containerElement;
        this.eventAggregator = eventAggregator;
        this.htmlContent = ''; // Store the current HTML content

        this.contentElement = this.container.querySelector('.quote-preview-content');
        this.iframe = this.container.querySelector('.quote-preview-iframe');
        this.closeButton = this.container.querySelector('.preview-btn-secondary');
        this.printButton = this.container.querySelector('.preview-btn-primary');
        this.htmlButton = this.container.querySelector('.preview-btn-html');

        this.initialize();
        console.log("QuotePreviewComponent Initialized.");
    }

    initialize() {
        this.eventAggregator.subscribe(EVENTS.SHOW_QUOTE_PREVIEW, (htmlContent) => this.show(htmlContent));

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.hide());
        }

        if (this.printButton) {
            this.printButton.addEventListener('click', () => this.print());
        }

        if (this.htmlButton) {
            this.htmlButton.addEventListener('click', () => this.copyHtmlToClipboard());
        }

        this.container.addEventListener('click', (event) => {
            if (event.target === this.container) {
                this.hide();
            }
        });
    }

    /**
     * Displays the preview overlay and injects the final HTML content.
     * @param {string} htmlContent - The fully rendered HTML string to display.
     */
    show(htmlContent) {
        if (!this.iframe) return;

        this.htmlContent = htmlContent; // Store the content

        // Use srcdoc to inject the HTML content. This provides a clean sandbox.
        this.iframe.srcdoc = htmlContent;

        // Use a slight delay to allow the content to be parsed before showing the overlay
        setTimeout(() => {
            this.container.classList.add('is-visible');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        }, 50);
    }

    /**
     * Hides the preview overlay.
     */
    hide() {
        this.container.classList.remove('is-visible');
        document.body.style.overflow = ''; // Restore background scrolling
        if (this.iframe) {
            this.iframe.srcdoc = ''; // Clear content
        }
        this.htmlContent = ''; // Clear stored content
    }

    /**
     * Triggers the print dialog for the iframe's content.
     */
    print() {
        if (this.iframe && this.iframe.contentWindow) {
            this.iframe.contentWindow.print();
        } else {
            console.error("Could not access iframe content to print.");
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                message: "Error: Could not trigger print.",
                type: 'error'
            });
        }
    }

    /**
     * [MODIFIED] Dynamically loads the juice script from a LOCAL path if it's not already loaded.
     * Returns a promise that resolves when the script is ready.
     * @private
     */
    _loadJuiceScript() {
        return new Promise((resolve, reject) => {
            // If juice is already loaded, resolve immediately.
            if (typeof window.juice === 'function') {
                resolve();
                return;
            }

            // If a script is already in the process of loading, wait for it.
            const existingScript = document.querySelector('#juice-script');
            if (existingScript) {
                existingScript.addEventListener('load', () => resolve());
                existingScript.addEventListener('error', (e) => reject(e));
                return;
            }

            const script = document.createElement('script');
            script.id = 'juice-script';
            // [MODIFIED] Point to the local file instead of the external CDN.
            script.src = './04-core-code/lib/juice.min.js';
            script.onload = () => resolve();
            script.onerror = (e) => {
                console.error('Failed to load juice.min.js from local path.', e);
                reject(new Error('Failed to load the HTML processing library.'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Inlines CSS and copies the resulting HTML to the clipboard.
     * Now dynamically loads the script on demand and waits for it to be ready.
     */
    async copyHtmlToClipboard() {
        if (!this.htmlContent) {
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: "Error: No HTML content to copy.", type: 'error' });
            return;
        }

        try {
            await this._loadJuiceScript();

            const inlinedHtml = window.juice(this.htmlContent);

            await navigator.clipboard.writeText(inlinedHtml);

            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: "HTML with inlined styles copied to clipboard!" });

        } catch (error) {
            console.error('Failed to copy HTML: ', error);
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: error.message || "Error: Could not copy HTML to clipboard.", type: 'error' });
        }
    }
}