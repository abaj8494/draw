/**
 * UI Module - Toolbar & UI components
 */

const UI = {
    toolbar: null,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    isMobile: false,

    // Track expanded tool menus
    expandedMenus: {},

    /**
     * Initialize UI components
     */
    init() {
        this.toolbar = document.getElementById('toolbar');
        this.isMobile = window.innerWidth <= 768;

        this.setupToolButtons();
        this.setupBrushControls();
        this.setupShapeSnapToggle();
        this.setupBackgroundOptions();
        this.setupActionButtons();
        this.setupExportButtons();
        this.setupSaveButtons();
        this.setupModal();
        this.setupToolbarDrag();
        this.setupMobileToggle();
        this.setupToolbarMinimize();

        window.addEventListener('resize', () => this.handleResize());
    },

    /**
     * Setup tool selection buttons
     */
    setupToolButtons() {
        const toolBtns = document.querySelectorAll('.tool-btn:not(.subtool)');
        const subtoolBtns = document.querySelectorAll('.tool-btn.subtool');

        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                const expandable = btn.dataset.expandable;

                // Handle expandable tools (eraser, laser)
                if (expandable) {
                    const submenu = document.querySelector(`[data-submenu="${expandable}"]`);
                    const isCurrentlyExpanded = !submenu.classList.contains('hidden');

                    // If already expanded, collapse it
                    if (isCurrentlyExpanded) {
                        submenu.classList.add('hidden');
                        btn.classList.remove('expanded');
                        this.expandedMenus[expandable] = false;
                    } else {
                        // If this is already the active tool group, expand submenu
                        const isActiveToolGroup = this.isToolInGroup(Tools.currentTool, expandable);
                        if (isActiveToolGroup) {
                            submenu.classList.remove('hidden');
                            btn.classList.add('expanded');
                            this.expandedMenus[expandable] = true;
                        } else {
                            // First click - select the tool with default
                            this.setActiveToolButton(btn, toolBtns);
                            Tools.setTool(tool);
                        }
                    }
                } else {
                    // Regular tool - close any open submenus
                    this.closeAllSubmenus();

                    // Update active state
                    this.setActiveToolButton(btn, toolBtns);

                    // Set tool
                    Tools.setTool(tool);
                }
            });
        });

        // Subtool buttons
        subtoolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                const parentMenu = btn.closest('.tool-submenu');
                const expandableType = parentMenu.dataset.submenu;
                const parentBtn = document.querySelector(`[data-expandable="${expandableType}"]`);

                // Set the tool
                Tools.setTool(tool);

                // Update active state on parent button
                this.setActiveToolButton(parentBtn, toolBtns);

                // Collapse the submenu
                parentMenu.classList.add('hidden');
                parentBtn.classList.remove('expanded');
                this.expandedMenus[expandableType] = false;

                // Trigger auto-save to remember the default
                App.triggerAutoSave();
            });
        });
    },

    /**
     * Check if a tool belongs to an expandable group
     */
    isToolInGroup(tool, group) {
        if (group === 'eraser') {
            return tool === 'eraser-pixel' || tool === 'eraser-object';
        }
        if (group === 'laser') {
            return tool === 'laser-plain' || tool === 'laser-trail';
        }
        if (group === 'shape') {
            return tool.startsWith('shape-');
        }
        return false;
    },

    /**
     * Set active tool button
     */
    setActiveToolButton(activeBtn, allBtns) {
        allBtns.forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    },

    /**
     * Close all submenus
     */
    closeAllSubmenus() {
        document.querySelectorAll('.tool-submenu').forEach(menu => {
            menu.classList.add('hidden');
        });
        document.querySelectorAll('[data-expandable]').forEach(btn => {
            btn.classList.remove('expanded');
        });
        this.expandedMenus = {};
    },

    /**
     * Setup brush size and color controls
     */
    setupBrushControls() {
        const sizeSlider = document.getElementById('brush-size');
        const sizeValue = document.getElementById('brush-size-value');
        const colorPicker = document.getElementById('brush-color');
        const colorPresets = document.querySelectorAll('.color-preset');

        sizeSlider.addEventListener('input', () => {
            const size = sizeSlider.value;
            sizeValue.textContent = size;
            Tools.setSize(size);
        });

        colorPicker.addEventListener('input', () => {
            Tools.setColor(colorPicker.value);
        });

        colorPresets.forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                colorPicker.value = color;
                Tools.setColor(color);
            });
        });
    },

    /**
     * Setup shape snap toggle
     */
    setupShapeSnapToggle() {
        const shapeSnapCheckbox = document.getElementById('shape-snap');

        shapeSnapCheckbox.addEventListener('change', () => {
            Tools.setShapeSnap(shapeSnapCheckbox.checked);
            App.triggerAutoSave();
        });
    },

    /**
     * Setup background option buttons
     */
    setupBackgroundOptions() {
        const bgOptions = document.querySelectorAll('.bg-option');

        bgOptions.forEach(option => {
            option.addEventListener('click', () => {
                const bg = option.dataset.bg;

                // Update active state
                bgOptions.forEach(o => o.classList.remove('active'));
                option.classList.add('active');

                // Set background
                Canvas.setBackground(bg);
                App.triggerAutoSave();
            });
        });
    },

    /**
     * Setup undo/redo/clear buttons
     */
    setupActionButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const clearBtn = document.getElementById('clear-btn');

        undoBtn.addEventListener('click', () => {
            Canvas.undo();
            this.updateUndoRedoButtons();
            App.triggerAutoSave();
        });

        redoBtn.addEventListener('click', () => {
            Canvas.redo();
            this.updateUndoRedoButtons();
            App.triggerAutoSave();
        });

        clearBtn.addEventListener('click', () => {
            if (Canvas.strokes.length === 0) return;

            if (confirm('Clear the canvas? This cannot be undone.')) {
                Canvas.clearAll();
                this.updateUndoRedoButtons();
                App.triggerAutoSave();
            }
        });

        this.updateUndoRedoButtons();
    },

    /**
     * Update undo/redo button states
     */
    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        undoBtn.disabled = Canvas.undoStack.length === 0;
        redoBtn.disabled = Canvas.redoStack.length === 0;
    },

    /**
     * Setup export buttons
     */
    setupExportButtons() {
        document.getElementById('export-png').addEventListener('click', () => {
            Export.toPNG();
        });

        document.getElementById('export-svg').addEventListener('click', () => {
            Export.toSVG();
        });

        document.getElementById('export-pdf').addEventListener('click', () => {
            Export.toPDF();
        });
    },

    /**
     * Setup save/load buttons
     */
    setupSaveButtons() {
        document.getElementById('save-btn').addEventListener('click', () => {
            this.showSaveDialog();
        });

        document.getElementById('load-btn').addEventListener('click', () => {
            this.showLoadDialog();
        });
    },

    /**
     * Setup modal functionality
     */
    setupModal() {
        const modal = document.getElementById('file-modal');
        const closeBtn = document.getElementById('modal-close');
        const saveConfirm = document.getElementById('save-confirm');
        const saveNameInput = document.getElementById('save-name');

        closeBtn.addEventListener('click', () => this.closeModal());

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal();
        });

        saveConfirm.addEventListener('click', async () => {
            const name = saveNameInput.value.trim() || Storage.generateDefaultName();
            await App.saveDrawing(name);
            this.closeModal();
        });

        saveNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveConfirm.click();
            }
        });
    },

    /**
     * Show save dialog
     */
    showSaveDialog() {
        const modal = document.getElementById('file-modal');
        const saveForm = document.getElementById('save-form');
        const saveNameInput = document.getElementById('save-name');
        const modalTitle = document.querySelector('.modal-title');

        modalTitle.textContent = 'Save Drawing';
        saveForm.classList.remove('hidden');
        saveNameInput.value = Storage.generateDefaultName();
        saveNameInput.select();

        this.refreshFileList();
        modal.classList.remove('hidden');
    },

    /**
     * Show load dialog
     */
    showLoadDialog() {
        const modal = document.getElementById('file-modal');
        const saveForm = document.getElementById('save-form');
        const modalTitle = document.querySelector('.modal-title');

        modalTitle.textContent = 'Load Drawing';
        saveForm.classList.add('hidden');

        this.refreshFileList();
        modal.classList.remove('hidden');
    },

    /**
     * Close modal
     */
    closeModal() {
        const modal = document.getElementById('file-modal');
        modal.classList.add('hidden');
    },

    /**
     * Refresh file list in modal
     */
    async refreshFileList() {
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '';

        try {
            const drawings = await Storage.listDrawings();

            if (drawings.length === 0) {
                fileList.innerHTML = '<div class="no-files">No saved drawings</div>';
                return;
            }

            for (const drawing of drawings) {
                const item = document.createElement('div');
                item.className = 'file-item';

                const date = new Date(drawing.timestamp);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();

                item.innerHTML = `
                    <span class="file-item-name" title="${dateStr}">${drawing.name}</span>
                    <div class="file-item-actions">
                        <button class="file-item-btn load-btn">Load</button>
                        <button class="file-item-btn delete">Delete</button>
                    </div>
                `;

                // Load button
                item.querySelector('.load-btn').addEventListener('click', async () => {
                    await App.loadDrawing(drawing.id);
                    this.closeModal();
                });

                // Delete button
                item.querySelector('.delete').addEventListener('click', async () => {
                    if (confirm(`Delete "${drawing.name}"?`)) {
                        await Storage.deleteDrawing(drawing.id);
                        this.refreshFileList();
                    }
                });

                // Click name to load
                item.querySelector('.file-item-name').addEventListener('click', async () => {
                    await App.loadDrawing(drawing.id);
                    this.closeModal();
                });

                fileList.appendChild(item);
            }
        } catch (error) {
            console.error('Failed to list drawings:', error);
            fileList.innerHTML = '<div class="no-files">Error loading saved drawings</div>';
        }
    },

    /**
     * Setup toolbar dragging (desktop only)
     */
    setupToolbarDrag() {
        const header = document.querySelector('.toolbar-header');

        header.addEventListener('mousedown', (e) => {
            if (this.isMobile) return;

            this.isDragging = true;
            const rect = this.toolbar.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;

            // Keep within viewport bounds
            const maxX = window.innerWidth - this.toolbar.offsetWidth;
            const maxY = window.innerHeight - this.toolbar.offsetHeight;

            this.toolbar.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            this.toolbar.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
    },

    /**
     * Setup toolbar minimize button
     */
    setupToolbarMinimize() {
        const minimizeBtn = document.getElementById('toolbar-minimize');

        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toolbar.classList.toggle('minimized');
            minimizeBtn.innerHTML = this.toolbar.classList.contains('minimized') ? '+' : '&minus;';
        });
    },

    /**
     * Setup mobile toggle button
     */
    setupMobileToggle() {
        const toggleBtn = document.getElementById('mobile-toggle');
        const closeBtn = document.getElementById('toolbar-close');

        toggleBtn.addEventListener('click', () => {
            this.toolbar.classList.add('open');
            toggleBtn.classList.add('hidden');
        });

        closeBtn.addEventListener('click', () => {
            this.toolbar.classList.remove('open');
            toggleBtn.classList.remove('hidden');
        });
    },

    /**
     * Handle window resize
     */
    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;

        if (wasMobile !== this.isMobile) {
            // Reset toolbar position when switching between mobile/desktop
            if (!this.isMobile) {
                this.toolbar.classList.remove('open');
                this.toolbar.style.left = '20px';
                this.toolbar.style.top = '20px';
                document.getElementById('mobile-toggle').classList.remove('hidden');
            }
        }
    },

    /**
     * Update UI from settings
     */
    loadSettings(settings) {
        if (!settings) return;

        // Update tool selection
        if (settings.tool) {
            const toolBtns = document.querySelectorAll('.tool-btn:not(.subtool)');

            // Check if it's an expandable tool subtype
            let parentTool = null;
            if (settings.tool === 'eraser-pixel' || settings.tool === 'eraser-object') {
                parentTool = 'eraser';
            } else if (settings.tool === 'laser-plain' || settings.tool === 'laser-trail') {
                parentTool = 'laser';
            } else if (settings.tool && settings.tool.startsWith('shape-')) {
                parentTool = 'shape';
            }

            toolBtns.forEach(btn => {
                if (parentTool && btn.dataset.expandable === parentTool) {
                    btn.classList.add('active');
                } else if (!parentTool && btn.dataset.tool === settings.tool) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        // Update brush size
        if (settings.size) {
            document.getElementById('brush-size').value = settings.size;
            document.getElementById('brush-size-value').textContent = settings.size;
        }

        // Update brush color
        if (settings.color) {
            document.getElementById('brush-color').value = settings.color;
        }

        // Update shape snap
        if (settings.shapeSnap !== undefined) {
            document.getElementById('shape-snap').checked = settings.shapeSnap;
        }
    },

    /**
     * Update background selection UI
     */
    updateBackgroundSelection(bgKey) {
        const bgOptions = document.querySelectorAll('.bg-option');
        bgOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.bg === bgKey);
        });
    }
};
