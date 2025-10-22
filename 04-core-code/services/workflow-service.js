// File: 04-core-code/services/workflow-service.js

import { initialState } from '../config/initial-state.js';
import { EVENTS, DOM_IDS } from '../config/constants.js';
import * as uiActions from '../actions/ui-actions.js';
import * as quoteActions from '../actions/quote-actions.js';
import { paths } from '../config/paths.js';

/**
 * @fileoverview A dedicated service for coordinating complex, multi-step user workflows.
 * This service takes complex procedural logic out of the AppController.
 */
export class WorkflowService {
    constructor({ eventAggregator, stateService, fileService, calculationService, productFactory, detailConfigView }) {
        this.eventAggregator = eventAggregator;
        this.stateService = stateService;
        this.fileService = fileService;
        this.calculationService = calculationService;
        this.productFactory = productFactory;
        this.detailConfigView = detailConfigView; // [FIX] 修正拼寫錯誤 detailConfigViem -> detailConfigView
        this.quotePreviewComponent = null; // Will be set by AppContext

        this.f2InputSequence = [
            'f2-b10-wifi-qty', 'f2-b13-delivery-qty', 'f2-b14-install-qty',
            'f2-b15-removal-qty', 'f2-b17-mul-times', 'f2-b18-discount'
        ];
        console.log("WorkflowService Initialized.");
    }

    setQuotePreviewComponent(component) {
        this.quotePreviewComponent = component;
    }

    async handlePrintableQuoteRequest() {
        try {
            const [quoteTemplate, detailsTemplate] = await Promise.all([
                fetch(paths.partials.quoteTemplate).then(res => res.ok ? res.text() : Promise.reject(new Error(`Failed to load ${paths.partials.quoteTemplate}`))),
                fetch(paths.partials.detailedItemList).then(res => res.ok ? res.text() : Promise.reject(new Error(`Failed to load ${paths.partials.detailedItemList}`))),
            ]);

            const { quoteData, ui } = this.stateService.getState();
            const f3Data = this._getF3OverrideData();

            const templateData = this._prepareTemplateData(quoteData, ui, f3Data);

            const populatedDetailsPageHtml = this._populateTemplate(detailsTemplate, templateData);

            const styleMatch = populatedDetailsPageHtml.match(/<style>([\s\S]*)<\/style>/i);
            const detailsBodyMatch = populatedDetailsPageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);

            if (!detailsBodyMatch) {
                throw new Error("Could not find body content in the details template.");
            }

            const detailsStyleContent = styleMatch ? styleMatch[0] : '';
            const detailsBodyContent = detailsBodyMatch[1];

            let finalHtml = quoteTemplate.replace('</head>', `${detailsStyleContent}</head>`);
            finalHtml = finalHtml.replace('</body>', `${detailsBodyContent}</body>`);

            finalHtml = this._populateTemplate(finalHtml, templateData);

            this.eventAggregator.publish(EVENTS.SHOW_QUOTE_PREVIEW, finalHtml);

        } catch (error) {
            console.error("Error generating printable quote:", error);
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                message: "Failed to generate quote preview. See console for details.",
                type: 'error',
            });
        }
    }

    _getF3OverrideData() {
        const getValue = (id) => document.getElementById(id)?.value || '';
        return {
            quoteId: getValue('f3-quote-id'),
            issueDate: getValue('f3-issue-date'),
            dueDate: getValue('f3-due-date'),
            customerName: getValue('f3-customer-name'),
            customerAddress: getValue('f3-customer-address'),
            customerPhone: getValue('f3-customer-phone'),
            customerEmail: getValue('f3-customer-email'),
            finalOfferPrice: getValue('f3-final-offer-price'),
            termsConditions: getValue('f3-terms-conditions'),
        };
    }

    _formatCustomerInfo(f3Data) {
        let html = `<strong>${f3Data.customerName || ''}</strong><br>`;
        if (f3Data.customerAddress) html += `${f3Data.customerAddress.replace(/\n/g, '<br>')}<br>`;
        if (f3Data.customerPhone) html += `Phone: ${f3Data.customerPhone}<br>`;
        if (f3Data.customerEmail) html += `Email: ${f3Data.customerEmail}`;
        return html;
    }

    _generateItemsTableHtml(items, summaryData) {
        const headers = ['#', 'F-NAME', 'F-COLOR', 'Location', 'HD', 'DUAL', 'MOTOR', 'PRICE'];
        const mulTimes = summaryData.mulTimes || 1;

        const rows = items
            .filter(item => item.width && item.height) // Only include rows with dimensions
            .map((item, index) => {
                const finalPrice = (item.linePrice || 0) * mulTimes;

                let fabricClass = '';
                if (item.fabric && item.fabric.toLowerCase().includes('light-filter')) {
                    fabricClass = 'bg-light-filter';
                } else if (item.fabricType === 'SN') {
                    fabricClass = 'bg-screen';
                } else if (['B1', 'B2', 'B3', 'B4', 'B5'].includes(item.fabricType)) {
                    fabricClass = 'bg-blockout';
                }

                return `
                    <tr>
                        <td class="text-center">${index + 1}</td>
                        <td class="${fabricClass}">${item.fabric || ''}</td>
                        <td class="${fabricClass}">${item.color || ''}</td>
                        <td>${item.location || ''}</td>
                        <td class="text-center">${item.winder === 'HD' ? '✓' : ''}</td>
                        <td class="text-center">${item.dual === 'D' ? '✓' : ''}</td>
                        <td class="text-center">${item.motor ? '✓' : ''}</td>
                        <td class="text-right">$${finalPrice.toFixed(2)}</td>
                    </tr>
                `;
            })
            .join('');

        return `
            <table class="items-table">
                <thead>
                    <tr class="table-title">
                        <th colspan="${headers.length}">Roller Blinds - Detailed List</th>
                    </tr>
                    <tr>
                        ${headers.map(h => `<th>${h}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    _generatePageOneItemsTableHtml(summaryData, quoteData, ui) {
        const rows = [];
        const items = quoteData.products.rollerBlind.items;
        const validItemCount = items.filter(i => i.width && i.height).length;

        // 1. Roller Blinds Package
        rows.push(`
            <tr>
                <td data-label="#">1</td>
                <td data-label="Description">
                    <div class="description"><strong>Roller Blinds Package</strong></div>
                    <div class="details">See appendix for detailed specifications.</div>
                </td>
                <td data-label="QTY" class="align-right">${validItemCount}</td>
                <td data-label="Price" class="align-right">
                    <span class="original-price">$${(summaryData.firstRbPrice || 0).toFixed(2)}</span>
                </td>
                <td data-label="Discounted Price" class="align-right">
                    <span class="discounted-price">$${(summaryData.disRbPrice || 0).toFixed(2)}</span>
                </td>
            </tr>
        `);

        let itemNumber = 2;

        // 2. Installation Accessories
        if (summaryData.acceSum > 0) {
            rows.push(`
                <tr>
                    <td data-label="#">${itemNumber++}</td>
                    <td data-label="Description">
                        <div class="description"><strong>Installation Accessories</strong></div>
                        <div class="details">See appendix for detailed specifications.</div>
                    </td>
                    <td data-label="QTY" class="align-right">NA</td>
                    <td data-label="Price" class="align-right">$${(summaryData.acceSum || 0).toFixed(2)}</td>
                    <td data-label="Discounted Price" class="align-right">$${(summaryData.acceSum || 0).toFixed(2)}</td>
                </tr>
            `);
        }

        // 3. Motorised Accessories
        if (summaryData.eAcceSum > 0) {
            rows.push(`
                <tr>
                    <td data-label="#">${itemNumber++}</td>
                    <td data-label="Description">
                        <div class="description"><strong>Motorised Accessories</strong></div>
                        <div class="details">See appendix for detailed specifications.</div>
                    </td>
                    <td data-label="QTY" class="align-right">NA</td>
                    <td data-label="Price" class="align-right">$${(summaryData.eAcceSum || 0).toFixed(2)}</td>
                    <td data-label="Discounted Price" class="align-right">$${(summaryData.eAcceSum || 0).toFixed(2)}</td>
                </tr>
            `);
        }

        // 4. Delivery
        const deliveryExcluded = ui.f2.deliveryFeeExcluded;
        const deliveryPriceClass = deliveryExcluded ? 'class="align-right is-excluded"' : 'class="align-right"';
        const deliveryDiscountedPrice = deliveryExcluded ? 0 : (summaryData.deliveryFee || 0);
        rows.push(`
            <tr>
                <td data-label="#">${itemNumber++}</td>
                <td data-label="Description">
                    <div class="description">Delivery</div>
                </td>
                <td data-label="QTY" class="align-right">${ui.f2.deliveryQty || 1}</td>
                <td data-label="Price" ${deliveryPriceClass}>$${(summaryData.deliveryFee || 0).toFixed(2)}</td>
                <td data-label="Discounted Price" class="align-right">$${deliveryDiscountedPrice.toFixed(2)}</td>
            </tr>
        `);

        // 5. Installation
        const installExcluded = ui.f2.installFeeExcluded;
        const installPriceClass = installExcluded ? 'class="align-right is-excluded"' : 'class="align-right"';
        const installDiscountedPrice = installExcluded ? 0 : (summaryData.installFee || 0);
        rows.push(`
            <tr>
                <td data-label="#">${itemNumber++}</td>
                <td data-label="Description">
                    <div class="description">Installation</div>
                </td>
                <td data-label="QTY" class="align-right">${validItemCount}</td>
                <td data-label="Price" ${installPriceClass}>$${(summaryData.installFee || 0).toFixed(2)}</td>
                <td data-label="Discounted Price" class="align-right">$${installDiscountedPrice.toFixed(2)}</td>
            </tr>
        `);

        // 6. Removal
        const removalExcluded = ui.f2.removalFeeExcluded;
        const removalPriceClass = removalExcluded ? 'class="align-right is-excluded"' : 'class="align-right"';
        const removalDiscountedPrice = removalExcluded ? 0 : (summaryData.removalFee || 0);
        rows.push(`
            <tr>
                <td data-label="#">${itemNumber++}</td>
                <td data-label="Description">
                    <div class="description">Removal</div>
                </td>
                <td data-label="QTY" class="align-right">${ui.f2.removalQty || 0}</td>
                <td data-label="Price" ${removalPriceClass}>$${(summaryData.removalFee || 0).toFixed(2)}</td>
                <td data-label="Discounted Price" class="align-right">$${removalDiscountedPrice.toFixed(2)}</td>
            </tr>
        `);

        return rows.join('');
    }


    _prepareTemplateData(quoteData, ui, f3Data) {
        const summaryData = this.calculationService.calculateF2Summary(quoteData, ui);
        const grandTotal = parseFloat(f3Data.finalOfferPrice) || summaryData.gst || 0;
        const items = quoteData.products.rollerBlind.items;

        return {
            // --- Header & Customer Info ---
            quoteId: f3Data.quoteId,
            issueDate: f3Data.issueDate,
            dueDate: f3Data.dueDate,
            customerInfoHtml: this._formatCustomerInfo(f3Data),

            // --- Main Items Table (Implemented in Stage 3) ---
            itemsTableBody: this._generatePageOneItemsTableHtml(summaryData, quoteData, ui),

            // --- Summary Section ---
            subtotal: `$${(summaryData.sumPrice || 0).toFixed(2)}`,
            gst: `$${(grandTotal / 1.1 * 0.1).toFixed(2)}`,
            grandTotal: `$${grandTotal.toFixed(2)}`,
            deposit: `$${(grandTotal * 0.5).toFixed(2)}`,
            balance: `$${(grandTotal * 0.5).toFixed(2)}`,
            savings: `$${((summaryData.firstRbPrice || 0) - (summaryData.disRbPrice || 0)).toFixed(2)}`,

            // --- Terms & Appendix ---
            termsAndConditions: (f3Data.termsConditions || 'Standard terms and conditions apply.').replace(/\n/g, '<br>'),
            rollerBlindsTable: this._generateItemsTableHtml(items, summaryData), // For appendix page
        };
    }

    _populateTemplate(template, data) {
        return template.replace(/\{\{\{?([\w\-]+)\}\}\}?/g, (match, key) => {
            return data.hasOwnProperty(key) ? data[key] : match;
        });
    }

    handleRemoteDistribution() {
        const { ui } = this.stateService.getState();
        const totalRemoteCount = ui.driveRemoteCount || 0;

        const initial1ch = ui.f1.remote_1ch_qty;
        const initial16ch = (ui.f1.remote_16ch_qty === null) ? totalRemoteCount - initial1ch : ui.f1.remote_16ch_qty;

        this.eventAggregator.publish(EVENTS.SHOW_CONFIRMATION_DIALOG, {
            message: `Total remotes: ${totalRemoteCount}. Please distribute them.`,
            layout: [
                [
                    { type: 'text', text: '1-Ch Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_1CH, value: initial1ch },
                    { type: 'text', text: '16-Ch Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_16CH, value: initial16ch }
                ],
                [
                    {
                        type: 'button',
                        text: 'Confirm',
                        className: 'primary-confirm-button',
                        colspan: 2,
                        callback: () => {
                            const qty1ch = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_1CH).value, 10);
                            const qty16ch = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_16CH).value, 10);

                            if (isNaN(qty1ch) || isNaN(qty16ch) || qty1ch < 0 || qty16ch < 0) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: 'Quantities must be positive numbers.', type: 'error' });
                                return false;
                            }

                            if (qty1ch + qty16ch !== totalRemoteCount) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                                    message: `Total must equal ${totalRemoteCount}. Current total: ${qty1ch + qty16ch}.`,
                                    type: 'error'
                                });
                                return false;
                            }

                            this.stateService.dispatch(uiActions.setF1RemoteDistribution(qty1ch, qty16ch));
                            return true;
                        }
                    },
                    { type: 'button', text: 'Cancel', className: 'secondary', colspan: 2, callback: () => { } }
                ]
            ],
            onOpen: () => {
                const input1ch = document.getElementById(DOM_IDS.DIALOG_INPUT_1CH);
                const input16ch = document.getElementById(DOM_IDS.DIALOG_INPUT_16CH);

                input1ch.addEventListener('input', () => {
                    const qty1ch = parseInt(input1ch.value, 10);
                    if (!isNaN(qty1ch) && qty1ch >= 0 && qty1ch <= totalRemoteCount) {
                        input16ch.value = totalRemoteCount - qty1ch;
                    }
                });

                input16ch.addEventListener('input', () => {
                    const qty16ch = parseInt(input16ch.value, 10);
                    if (!isNaN(qty16ch) && qty16ch >= 0 && qty16ch <= totalRemoteCount) {
                        input1ch.value = totalRemoteCount - qty16ch;
                    }
                });

                setTimeout(() => {
                    input1ch.focus();
                    input1ch.select();
                }, 0);
            },
            closeOnOverlayClick: false
        });
    }

    handleDualDistribution() {
        const { quoteData, ui } = this.stateService.getState();
        const items = quoteData.products[quoteData.currentProduct].items;
        const totalDualPairs = Math.floor(items.filter(item => item.dual === 'D').length / 2);

        const initialCombo = (ui.f1.dual_combo_qty === null) ? totalDualPairs : ui.f1.dual_combo_qty;
        const initialSlim = (ui.f1.dual_slim_qty === null) ? 0 : ui.f1.dual_slim_qty;

        this.eventAggregator.publish(EVENTS.SHOW_CONFIRMATION_DIALOG, {
            message: `Total Dual pairs: ${totalDualPairs}. Please distribute them.`,
            layout: [
                [
                    { type: 'text', text: 'Combo Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_COMBO, value: initialCombo },
                    { type: 'text', text: 'Slim Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_SLIM, value: initialSlim }
                ],
                [
                    {
                        type: 'button',
                        text: 'Confirm',
                        className: 'primary-confirm-button',
                        colspan: 2,
                        callback: () => {
                            const qtyCombo = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_COMBO).value, 10);
                            const qtySlim = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_SLIM).value, 10);

                            if (isNaN(qtyCombo) || isNaN(qtySlim) || qtyCombo < 0 || qtySlim < 0) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: 'Quantities must be positive numbers.', type: 'error' });
                                return false;
                            }

                            if (qtyCombo + qtySlim !== totalDualPairs) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                                    message: `Total must equal ${totalDualPairs}. Current total: ${qtyCombo + qtySlim}.`,
                                    type: 'error'
                                });
                                return false;
                            }

                            this.stateService.dispatch(uiActions.setF1DualDistribution(qtyCombo, qtySlim));
                            return true;
                        }
                    },
                    { type: 'button', text: 'Cancel', className: 'secondary', colspan: 2, callback: () => { } }
                ]
            ],
            onOpen: () => {
                const inputCombo = document.getElementById(DOM_IDS.DIALOG_INPUT_COMBO);
                const inputSlim = document.getElementById(DOM_IDS.DIALOG_INPUT_SLIM);

                inputSlim.addEventListener('input', () => {
                    const qtySlim = parseInt(inputSlim.value, 10);
                    if (!isNaN(qtySlim) && qtySlim >= 0 && qtySlim <= totalDualPairs) {
                        inputCombo.value = totalDualPairs - qtySlim;
                    }
                });

                inputCombo.addEventListener('input', () => {
                    const qtyCombo = parseInt(inputCombo.value, 10);
                    if (!isNaN(qtyCombo) && qtyCombo >= 0 && qtyCombo <= totalDualPairs) {
                        inputSlim.value = totalDualPairs - qtyCombo;
                    }
                });

                setTimeout(() => {
                    inputSlim.focus();
                    inputSlim.select();
                }, 0);
            },
            closeOnOverlayClick: false
        });
    }

    handleF1TabActivation() {
        const { quoteData } = this.stateService.getState();
        const productStrategy = this.productFactory.getProductStrategy(quoteData.currentProduct);
        const { updatedQuoteData } = this.calculationService.calculateAndSum(quoteData, productStrategy);

        this.stateService.dispatch(quoteActions.setQuoteData(updatedQuoteData));
    }

    handleF2TabActivation() {
        const { quoteData } = this.stateService.getState();
        const productStrategy = this.productFactory.getProductStrategy(quoteData.currentProduct);
        const { updatedQuoteData } = this.calculationService.calculateAndSum(quoteData, productStrategy);

        this.stateService.dispatch(quoteActions.setQuoteData(updatedQuoteData));

        this.detailConfigView.driveAccessoriesView.recalculateAllDriveAccessoryPrices();
        this.detailConfigView.dualChainView._calculateAndStoreDualPrice();

        this._calculateF2Summary();

        this.eventAggregator.publish(EVENTS.FOCUS_ELEMENT, { elementId: 'f2-b10-wifi-qty' });
    }

    handleNavigationToDetailView() {
        const { ui } = this.stateService.getState();
        if (ui.currentView === 'QUICK_QUOTE') {
            this.stateService.dispatch(uiActions.setCurrentView('DETAIL_CONFIG'));
            this.detailConfigView.activateTab('k1-tab');
        } else {
            this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
            this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
        }
    }

    handleNavigationToQuickQuoteView() {
        this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
        this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
    }

    handleTabSwitch({ tabId }) {
        this.detailConfigView.activateTab(tabId);
    }

    handleUserRequestedLoad() {
        const { quoteData } = this.stateService.getState();
        const productKey = quoteData.currentProduct;
        const items = quoteData.products[productKey] ? quoteData.products[productKey].items : [];
        const hasData = items.length > 1 || (items.length === 1 && (items[0].width || items[0].height));

        if (hasData) {
            this.eventAggregator.publish(EVENTS.SHOW_LOAD_CONFIRMATION_DIALOG);
        } else {
            this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
        }
    }

    handleLoadDirectly() {
        this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
    }

    handleFileLoad({ fileName, content }) {
        const result = this.fileService.parseFileContent(fileName, content);
        if (result.success) {
            this.stateService.dispatch(quoteActions.setQuoteData(result.data));
            this.stateService.dispatch(uiActions.resetUi());
            this.stateService.dispatch(uiActions.setSumOutdated(true));
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message });
        } else {
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message, type: 'error' });
        }
    }

    handleF1DiscountChange({ percentage }) {
        this.stateService.dispatch(uiActions.setF1DiscountPercentage(percentage));
    }

    handleToggleFeeExclusion({ feeType }) {
        this.stateService.dispatch(uiActions.toggleF2FeeExclusion(feeType));
        this._calculateF2Summary();
    }

    handleF2ValueChange({ id, value }) {
        const numericValue = value === '' ? null : parseFloat(value);
        let keyToUpdate = null;

        switch (id) {
            case 'f2-b10-wifi-qty': keyToUpdate = 'wifiQty'; break;
            case 'f2-b13-delivery-qty': keyToUpdate = 'deliveryQty'; break;
            case 'f2-b14-install-qty': keyToUpdate = 'installQty'; break;
            case 'f2-b15-removal-qty': keyToUpdate = 'removalQty'; break;
            case 'f2-b17-mul-times': keyToUpdate = 'mulTimes'; break;
            case 'f2-b18-discount': keyToUpdate = 'discount'; break;
        }

        if (keyToUpdate) {
            this.stateService.dispatch(uiActions.setF2Value(keyToUpdate, numericValue));
            this._calculateF2Summary();
        }
    }

    focusNextF2Input(currentId) {
        const currentIndex = this.f2InputSequence.indexOf(currentId);
        if (currentIndex > -1 && currentIndex < this.f2InputSequence.length - 1) {
            const nextElementId = this.f2InputSequence[currentIndex + 1];
            this.eventAggregator.publish(EVENTS.FOCUS_ELEMENT, { elementId: nextElementId });
        } else {
            // If it's the last element, blur it.
            const currentElement = document.getElementById(currentId);
            currentElement?.blur();
        }
    }

    _calculateF2Summary() {
        const { quoteData, ui } = this.stateService.getState();
        const summaryValues = this.calculationService.calculateF2Summary(quoteData, ui);
        for (const key in summaryValues) {
            this.stateService.dispatch(uiActions.setF2Value(key, summaryValues[key]));
        }
    }
}