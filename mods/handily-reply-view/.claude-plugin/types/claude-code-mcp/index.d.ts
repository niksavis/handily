// The inputs of the MCP tools the session had connected when this mod
// was last saved, from each server's tools/list inputSchema.
// Merges into the engine's ToolCallInput (types/ McpToolInputs) so
// `e.tool === "mcp__<server>__<tool>"` narrows to the tool's arguments.
// Written again at a save of the mod with a server connected.
export {}
declare module 'claude-code' {
  interface McpToolInputs {
    /** Execute a sequence of browser tool calls in ONE round trip. Each item is {name, input} where input is exactly what you'd pass to that tool standalone. Actions execute SEQUENTIALLY (not in parallel) and stop on the first error. Use this tool extensively to quickly execute work whenever you can predict two or more steps ahead — e.g. navigate, click a field, type, press Return, screenshot. Each tool's own permission check runs per item — if an action navigates to a domain without permission, the next item's check fails and the batch stops. Screenshots and other images are returned interleaved with outputs; coordinates you write in THIS batch refer to the screenshot taken BEFORE this call. browser_batch cannot be nested. */
    "mcp__claude-in-chrome__browser_batch": {
      /** List of tool calls to execute sequentially. Example: [{"name":"computer","input":{"action":"left_click","coordinate":[100,200],"tabId":123}},{"name":"computer","input":{"action":"type","text":"hello","tabId":123}},{"name":"navigate","input":{"url":"https://example.com","tabId":123}}] */
      actions: Array<{
        /** Tool name (e.g. computer, navigate, find, tabs_create_mcp). browser_batch cannot be nested. */
        name: string
        /** That tool's input — same shape you'd pass when calling it directly. For computer items whose action is left_click, right_click, double_click, triple_click, left_click_drag, key or type, and for form_input items, include action_summary in the item's input, as you would when calling that tool directly. */
        input: {}
      }>
    }
    /** Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. * Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor. * If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click. * Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked. */
    "mcp__claude-in-chrome__computer": {
      /** The action to perform: * `left_click`: Click the left mouse button at the specified coordinates. * `right_click`: Click the right mouse button at the specified coordinates to open context menus. * `double_click`: Double-click the left mouse button at the specified coordinates. * `triple_click`: Triple-click the left mouse button at the specified coordinates. * `type`: Type a string of text. * `screenshot`: Take a screenshot of the screen. * `wait`: Wait for a specified number of seconds. * `scroll`: Scroll up, down, left, or right at the specified coordinates. * `key`: Press a specific keyboard key. * `left_click_drag`: Drag from start_coordinate to coordinate. * `zoom`: Take a screenshot of a specific region for closer inspection. * `scroll_to`: Scroll an element into view using its element reference ID from read_page or find tools. * `hover`: Move the mouse cursor to the specified coordinates or element without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states. */
      action: "left_click" | "right_click" | "type" | "screenshot" | "wait" | "scroll" | "key" | "left_click_drag" | "double_click" | "triple_click" | "zoom" | "scroll_to" | "hover"
      /** (x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates. Required for `left_click`, `right_click`, `double_click`, `triple_click`, and `scroll`. For `left_click_drag`, this is the end position. */
      coordinate?: number[]
      /** The text to type (for `type` action) or the key(s) to press (for `key` action). For `key` action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform's modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" or "ctrl+a" for select all). Page zoom shortcuts (e.g. "cmd+=", "ctrl+-", "cmd+0") are not supported and will return an error - use the `zoom` action to magnify a region of the page instead. */
      text?: string
      /** The number of seconds to wait. Required for `wait`. Maximum 10 seconds. */
      duration?: number
      /** The direction to scroll. Required for `scroll`. */
      scroll_direction?: "up" | "down" | "left" | "right"
      /** The number of scroll wheel ticks. Optional for `scroll`, defaults to 3. */
      scroll_amount?: number
      /** (x, y): The starting coordinates for `left_click_drag`. */
      start_coordinate?: number[]
      /** (x0, y0, x1, y1): The rectangular region to capture for `zoom`. Coordinates define a rectangle from top-left (x0, y0) to bottom-right (x1, y1) in pixels from the viewport origin. Required for `zoom` action. Useful for inspecting small UI elements like icons, buttons, or text. */
      region?: number[]
      /** For `screenshot` and `zoom` only. Scale factor in [0.1, 1] for the returned image; 1 (default) uses the full image token budget, 0.5 returns an image at half the width and height (~quarter of the tokens). Coordinates are ALWAYS in the full-resolution coordinate frame (reported with every scaled screenshot), never in the scaled image's own pixels. Requires a Claude in Chrome extension version that supports scale; older extensions return the full-size image. */
      scale?: number
      /** Number of times to repeat the key sequence. Only applicable for `key` action. Must be a positive integer between 1 and 100. Default is 1. Useful for navigation tasks like pressing arrow keys multiple times. */
      repeat?: number
      /** Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Required for `scroll_to` action. Can be used as alternative to `coordinate` for click actions. */
      ref?: string
      /** Modifier keys for click actions. Supports: "ctrl", "shift", "alt", "cmd" (or "meta"), "win" (or "windows"). Can be combined with "+" (e.g., "ctrl+shift", "cmd+alt"). Optional. */
      modifiers?: string
      /** Tab ID to execute the action on. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** For screenshot/zoom actions: save the image to disk so it can be attached to a message for the user. Returns the saved path in the tool result. Only set this when you intend to share the image — screenshots you're just looking at don't need saving. */
      save_to_disk?: boolean
      /** A few words saying what this action does on the page and to what, for example 'Sends the drafted reply to pat@example.com' or 'Opens the Filters menu'. Set it on every left_click, right_click, double_click, triple_click, left_click_drag, key and type action. State the effect only, and accurately: no reasons, nothing about what you were asked or allowed to do, no passwords or other secrets. */
      action_summary?: string
    }
    /** Upload one or multiple files to a file input element on the page. Do not click on file upload buttons or file inputs — clicking opens a native file picker dialog that you cannot see or interact with. Instead, use read_page or find to locate the file input element, then use this tool with its ref to upload files directly. Only files the user has shared with this session (attachments, the session's outputs/uploads folders, or folders the user has connected) can be uploaded; other paths will be rejected. The combined size of all files in a single call must stay under 10 MB. */
    "mcp__claude-in-chrome__file_upload": {
      /** Absolute paths to the files to upload. Each path must be a file the user has shared with this session. */
      paths: string[]
      /** Element reference ID of the file input from read_page or find tools (e.g., "ref_1", "ref_2"). */
      ref: string
      /** Tab ID where the file input is located. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** Find elements on the page using natural language. Can search for elements by their purpose (e.g., "search bar", "login button") or by text content (e.g., "organic mango product"). Returns up to 20 matching elements with references that can be used with other tools. If more than 20 matches exist, you'll be notified to use a more specific query. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__find": {
      /** Natural language description of what to find (e.g., "search bar", "add to cart button", "product title containing organic") */
      query: string
      /** Tab ID to search in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** Set values in form elements using element reference ID from the read_page tool. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__form_input": {
      /** Element reference ID from the read_page tool (e.g., "ref_1", "ref_2") */
      ref: string
      /** The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number */
      value: string | boolean | number
      /** Tab ID to set form value in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** A few words saying what this form fill does on the page and to what, for example 'Sets the delivery date to 29 September'. State the effect only, and accurately: no reasons, nothing about what you were asked or allowed to do, no passwords or other secrets. */
      action_summary?: string
    }
    /** Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__get_page_text": {
      /** Tab ID to extract text from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF. */
    "mcp__claude-in-chrome__gif_creator": {
      /** Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames) */
      action: "start_recording" | "stop_recording" | "export" | "clear"
      /** Tab ID to identify which tab group this operation applies to */
      tabId: number
      /** Always set this to true for the 'export' action only. This causes the gif to be downloaded in the browser. */
      download?: boolean
      /** Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only. */
      filename?: string
      /** Optional GIF enhancement options for 'export' action. Properties: showClickIndicators (bool), showDragPaths (bool), showActionLabels (bool), showProgressBar (bool), showWatermark (bool), quality (number 1-30). All default to true except quality (default: 10). */
      options?: {
        /** Show orange circles at click locations (default: true) */
        showClickIndicators?: boolean
        /** Show red arrows for drag actions (default: true) */
        showDragPaths?: boolean
        /** Show black labels describing actions (default: true) */
        showActionLabels?: boolean
        /** Show orange progress bar at bottom (default: true) */
        showProgressBar?: boolean
        /** Show Claude logo watermark (default: true) */
        showWatermark?: boolean
        /** GIF compression quality, 1-30 (lower = better quality, slower encoding). Default: 10 */
        quality?: number
      }
    }
    /** Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__javascript_tool": {
      /** Must be set to 'javascript_exec' */
      action: string
      /** The JavaScript code to execute. Evaluated in the page context with REPL semantics: top-level `await` works, and the result of the last expression is returned automatically — write the expression you want (e.g. `window.myData.value`, or `await fetch(url).then(r=>r.json())`) rather than `return ...`. You can access and modify the DOM, call page functions, and interact with page variables. */
      text: string
      /** Tab ID to execute the code in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** List all Chrome browsers (extension instances) currently connected to this account. Returns each browser's deviceId, display name, OS platform, isLocal (its OS matches this computer's, a weak hint), when known onThisComputer (it is, or recently was, running on this computer), and inUse on the browser this session's actions go to when that is settled. When the user needs to choose a browser, use this to present the choices before select_browser. You do not need to call this before using the browser: when one browser is connected, or one was already chosen for this session, browser tools just work. Only if a browser tool reports that several browsers are connected and none is selected, or the user asks to change browsers, ask with the AskUserQuestion tool: one option per connected browser, the ones on this computer first (display name as the label, deviceId in parentheses), plus a final option labeled exactly: "Open a confirmation screen in every connected Chrome extension and let me select the right one there." Then call select_browser with the chosen deviceId, or switch_browser for the final option. Never pick one yourself. */
    "mcp__claude-in-chrome__list_connected_browsers": {}
    /** Navigate to a URL, or go forward/back in browser history. tabId may be omitted for URL navigation when calling navigate STANDALONE (not inside browser_batch): tabs_context_mcp{createIfEmpty:true} is called for you and the first tab in the session's group is navigated — its result is appended to this call's output so you have the tab list and ids for subsequent calls. Inside browser_batch, navigate (and other tools that act on a page) requires an explicit tabId. Pass an explicit tabId when you need a specific tab or when the session's group has multiple tabs whose state you must preserve. tabId is required for url:"back"/"forward". A tab opened for you this way is yours to clean up, the same as one from tabs_create_mcp: close it with tabs_close_mcp once you no longer need it and before finishing your task, unless the user asked to see it or wants it kept open. */
    "mcp__claude-in-chrome__navigate": {
      /** The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history. */
      url: string
      /** Tab ID to navigate. Must be a tab in the current group. If omitted for URL navigation when calling navigate standalone, tabs_context_mcp{createIfEmpty:true} is called for you. Required for url:"back"/"forward" and for navigate (and other tools that act on a page) inside browser_batch. */
      tabId?: number
    }
    /** Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. IMPORTANT: Always provide a pattern to filter messages - without a pattern, you may get too many irrelevant messages. */
    "mcp__claude-in-chrome__read_console_messages": {
      /** Tab ID to read console messages from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** If true, only return error and exception messages. Default is false (return all message types). */
      onlyErrors?: boolean
      /** If true, clear the console messages after reading to avoid duplicates on subsequent calls. Default is false. */
      clear?: boolean
      /** Regex pattern to filter console messages. Only messages matching this pattern will be returned (e.g., 'error|warning' to find errors and warnings, 'MyApp' to filter app-specific logs). You should always provide a pattern to avoid getting too many irrelevant messages. */
      pattern?: string
      /** Maximum number of messages to return. Defaults to 100. Increase only if you need more results. */
      limit?: number
    }
    /** Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making. Returns all network requests made by the current page, including cross-origin requests. Requests are automatically cleared when the page navigates to a different domain. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__read_network_requests": {
      /** Tab ID to read network requests from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned (e.g., '/api/' to filter API calls, 'example.com' to filter by domain). */
      urlPattern?: string
      /** If true, clear the network requests after reading to avoid duplicates on subsequent calls. Default is false. */
      clear?: boolean
      /** Maximum number of requests to return. Defaults to 100. Increase only if you need more results. */
      limit?: number
    }
    /** Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters by default. If the output exceeds this limit it is truncated at a line boundary, with a note giving the full size — pass a larger max_chars, or use depth/ref_id to focus on part of the page. Optionally filter for only interactive elements. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__read_page": {
      /** Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements including non-visible ones (default: all elements) */
      filter?: "interactive" | "all"
      /** Tab ID to read from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large. */
      depth?: number
      /** Reference ID of a parent element to read. Will return the specified element and all its children. Use this to focus on a specific part of the page when output is too large. */
      ref_id?: string
      /** Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs. */
      max_chars?: number
    }
    /** Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. */
    "mcp__claude-in-chrome__resize_window": {
      /** Target window width in pixels */
      width: number
      /** Target window height in pixels */
      height: number
      /** Tab ID to get the window for. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** Select a specific Chrome browser by deviceId for browser automation, without broadcasting a pairing request. Use this after list_connected_browsers when the user has chosen one from the list. */
    "mcp__claude-in-chrome__select_browser": {
      /** The deviceId from list_connected_browsers. */
      deviceId: string
    }
    /** Execute a shortcut or workflow by running it in a new sidepanel window using the current tab (shortcuts and workflows are interchangeable). Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately - it does not wait for completion. */
    "mcp__claude-in-chrome__shortcuts_execute": {
      /** Tab ID to execute the shortcut on. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
      /** The ID of the shortcut to execute */
      shortcutId?: string
      /** The command name of the shortcut to execute (e.g., 'debug', 'summarize'). Do not include the leading slash. */
      command?: string
    }
    /** List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow. */
    "mcp__claude-in-chrome__shortcuts_list": {
      /** Tab ID to list shortcuts from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID. */
      tabId: number
    }
    /** Send a connection request to every Chrome browser with the extension installed and wait (up to 2 minutes) for the user to click 'Connect' in the one they want to use. The user can name the browser when they connect. Use this when the user wants to pick the browser themselves from inside Chrome rather than choosing from a list; otherwise prefer select_browser with a known deviceId. */
    "mcp__claude-in-chrome__switch_browser": {}
    /** Close a tab in the MCP tab group by its ID. Use to clean up tabs you're done with. Only tabs in this session's group are closable; call tabs_context_mcp first to get valid IDs. If you close the group's last tab, Chrome auto-removes the group — the next tabs_context_mcp with createIfEmpty starts fresh. */
    "mcp__claude-in-chrome__tabs_close_mcp": {
      /** The ID of the tab to close. Must be in this session's tab group. Get valid IDs from tabs_context_mcp. */
      tabId: number
    }
    /** Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: You must get the context at least once before using other browser automation tools so you know what tabs exist. Each new conversation should create its own new tab (using tabs_create_mcp) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab. */
    "mcp__claude-in-chrome__tabs_context_mcp": {
      /** Creates a new MCP tab group if none exists, creates a new Window with a new tab group containing an empty tab (which can be used for this conversation). If a MCP tab group already exists, this parameter has no effect. */
      createIfEmpty?: boolean
    }
    /** Creates a new empty tab in the MCP tab group. CRITICAL: You must get the context using tabs_context_mcp at least once before using other browser automation tools so you know what tabs exist. Tabs you create are yours to clean up: close each one with tabs_close_mcp as soon as you no longer need it, and close any that remain before finishing your task. Leave a tab open only if the user asked to see it or wants it kept open. */
    "mcp__claude-in-chrome__tabs_create_mcp": {}
    /** Upload a screenshot you took with the computer tool's screenshot action to a file input or drag & drop target. Screenshot IDs expire a few minutes after capture, so take the screenshot of what you want to upload right before uploading. Don't reuse an ID that an upload already failed with: to retry, take a new screenshot of the same content, and retry that upload at most once (never after the user declined). This tool cannot upload user-attached images or other files; use file_upload with the file's path for those, if that tool is available. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both. */
    "mcp__claude-in-chrome__upload_image": {
      /** ID of a screenshot from the computer tool's screenshot action, taken shortly before this call. IDs of user-attached images are not accepted. */
      imageId: string
      /** Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both. */
      ref?: string
      /** Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both. */
      coordinate?: number[]
      /** Tab ID where the target element is located. This is where the image will be uploaded to. */
      tabId: number
      /** Optional filename for the uploaded file (default: "image.png") */
      filename?: string
    }
  }
}
