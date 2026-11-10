// Koi Pond Wallpaper: single source of truth for every user-adjustable setting.
// - prefs.js builds the Preferences window from this table.
// - schemas/*.gschema.xml is generated from this table (see tools/gen.mjs).
// - extension.js reads each value by `key` and assigns it to the variable `name`.
//
// Each row: key (GSettings key), name (variable in extension.js, null = handled specially),
// type ('int' | 'double' | 'bool'), def, min, max, step, title, sub,
// structural: true => changing it rebuilds the pond (counts, resolution...).

export const SCHEMA_ID = 'org.gnome.shell.extensions.koipond';

const I = (key, name, title, sub, def, min, max, step = 1, extra = {}) =>
    ({key, name, type: 'int', title, sub, def, min, max, step, ...extra});
const D = (key, name, title, sub, def, min, max, step = 0.1, digits = 2, extra = {}) =>
    ({key, name, type: 'double', title, sub, def, min, max, step, digits, ...extra});
const B = (key, name, title, sub, def, extra = {}) =>
    ({key, name, type: 'bool', title, sub, def, ...extra});

export const SPEC = [
    {
        id: 'perf', title: 'Performance', icon: 'preferences-system-symbolic',
        desc: 'Balance smoothness against CPU usage.',
        rows: [
            I('fps-min', 'FPS_MIN', 'Minimum FPS', 'Used when everything is calm (lower = lighter on the CPU)', 5, 1, 30),
            I('fps-max', 'FPS_MAX', 'Maximum FPS', 'Used while dragging the mouse or when leaves / waves move fast', 40, 10, 60),
            I('active-speed', 'ACTIVE_SPEED', 'Speed threshold for maximum FPS', 'Leaves drifting at this speed make the pond run at maximum FPS', 40, 5, 200),
            I('pixel-size', 'PIXEL_SIZE', 'Pixel size', 'Each pixel-art pixel = N screen pixels (smaller = finer but heavier)', 4, 2, 10, 1, {structural: true}),
            D('water-opacity', 'WATER_OPACITY', 'Water opacity', 'Below 1 lets the original wallpaper show through', 1.0, 0, 1, 0.05, 2, {structural: true}),
        ],
    },
    {
        id: 'scene', title: 'Scene', icon: 'applications-science-symbolic',
        desc: 'How many of each object are in the pond. Changing a count rebuilds the pond.',
        rows: [
            I('fish-count', 'FISH_COUNT', 'Koi fish', '', 7, 0, 30, 1, {structural: true}),
            I('pad-count', 'PAD_COUNT', 'Lily pads', '', 6, 0, 20, 1, {structural: true}),
            I('leaf-count', 'LEAF_COUNT', 'Fallen leaves', 'Small leaves drifting on the water surface', 9, 0, 40, 1, {structural: true}),
            I('weed-count', 'WEED_COUNT', 'Weed clusters', 'Waterweed on the bottom', 7, 0, 30, 1, {structural: true}),
            I('layout-seed', 'LAYOUT_SEED', 'Layout seed', 'Same number = same pond layout every time. 0 = pick a random one on first run and remember it', 0, 0, 999999, 1, {structural: true}),
        ],
    },
    {
        id: 'time', title: 'Time of day', icon: 'preferences-system-time-symbolic',
        desc: 'By default the pond follows your computer\'s real time.',
        rows: [
            B('time-override-enabled', null, 'Fix the time', 'Always show one specific hour (for previewing)', false),
            D('time-override-hour', null, 'Fixed hour', 'For example 18.5 = 18:30', 18.5, 0, 24, 0.25, 2, {dependsOn: 'time-override-enabled'}),
            I('time-speed', 'TIME_SPEED', 'Time speed', '1 = real time; 600 = a whole day passes in ~2.4 minutes', 1, 1, 3600, 1),
        ],
    },
    {
        id: 'sky', title: 'Sun & Moon', icon: 'weather-clear-symbolic',
        desc: 'PNG images from the sun/ and moon/ folders next to extension.js.',
        rows: [
            B('celestial', 'CELESTIAL', 'Draw sun / moon', 'When off, only the old glare is used (if enabled below)', true),
            D('sun-size', 'SUN_SIZE', 'Sun size', 'Longest side of the image as a fraction of the screen width', 0.12, 0.02, 0.4, 0.01),
            D('moon-size', 'MOON_SIZE', 'Moon size', 'Same as above, for the moon', 0.09, 0.02, 0.4, 0.01),
            D('celestial-opacity', 'CELESTIAL_OPACITY', 'Opacity', '', 1.0, 0, 1, 0.05),
            B('celestial-on-top', 'CELESTIAL_ON_TOP', 'Keep bright', 'Not darkened by the time-of-day tint; lily pads and leaves still cover it', true),
            B('glow', 'GLOW', 'Glow', '', true),
            D('glow-size', 'GLOW_SIZE', 'Glow size', 'Diameter as a multiple of the image size', 2.6, 1, 6, 0.1),
            D('glow-opacity', 'GLOW_OPACITY', 'Glow opacity', '', 0.40, 0, 1, 0.05),
            D('shimmer', 'SHIMMER', 'Reflection shimmer', '0 = perfectly still when there are no waves', 1.0, 0, 3, 0.1),
            D('wave-distort', 'WAVE_DISTORT', 'Wave distortion of the reflection', 'Higher = the reflection breaks up more', 40, 0, 150, 1, 0),
            I('reflect-seg', 'REFLECT_SEG', 'Reflection fragment width', 'The reflection is cut into pieces this many pixels wide (smaller = finer but heavier)', 8, 2, 32),
            I('moon-up-hours', 'MOON_UP_HOURS', 'Hours the moon stays up', 'Per moonrise', 12, 4, 20),
            B('new-moon-hidden', 'NEW_MOON_HIDDEN', 'Hide the new moon', 'Draw nothing on moonless days', true),
            B('moon-age-override-enabled', null, 'Fix the moon phase', 'For previewing the phases', false),
            D('moon-age', null, 'Moon age', '0 = new, 7.4 = first quarter, 14.8 = full, 22.1 = last quarter', 14.8, 0, 29.5, 0.1, 1, {dependsOn: 'moon-age-override-enabled'}),
        ],
    },
    {
        id: 'water', title: 'Water & Waves', icon: 'weather-showers-symbolic',
        desc: 'Real wave simulation on a height grid.',
        rows: [
            I('flow-speed', 'FLOW_SPEED', 'Current speed', 'Leaves and weeds drift with it; 0 = still water', 12, 0, 60),
            B('ambient-drops', 'AMBIENT_DROPS', 'Ambient raindrops', 'Small drops occasionally fall onto the water', false),
            B('glitter', 'GLITTER', 'Glitter', 'Twinkling sparkles on the water surface', false, {structural: true}),
            B('glare', 'GLARE', 'Legacy glare', 'Fallback when there are no sun / moon images', false),
            D('wave-drop', 'WAVE_DROP', 'Drop / click strength', '', 2.0, 0.2, 6, 0.1),
            D('wave-damp', 'WAVE_DAMP', 'Wave damping', 'Higher = waves die out faster', 0.006, 0, 0.05, 0.001, 3, {structural: true}),
            I('wave-cell', 'WAVE_CELL', 'Wave resolution', '1 wave cell = N pond pixels (1 = finer but about 4x heavier)', 2, 1, 4, 1, {structural: true}),
            I('wave-step-rate', 'WAVE_STEP_RATE', 'Simulation steps per second', 'Sets how fast waves travel', 40, 10, 80),
            D('wave-c2', 'WAVE_C2', 'Wave speed (squared)', 'Must stay below 0.5 for stability', 0.3, 0.05, 0.49, 0.01),
            D('ripple-life', 'RIPPLE_LIFE', 'Ripple startle time', 'Seconds a ripple keeps startling the fish', 3.4, 1, 10, 0.1),
        ],
    },
    {
        id: 'mouse', title: 'Mouse', icon: 'input-mouse-symbolic',
        desc: 'Click or hold and drag on the desktop background.',
        rows: [
            I('click-ms', 'CLICK_MS', 'Maximum click duration', 'ms: releasing faster than this counts as a click', 250, 50, 1000, 10),
            I('click-move', 'CLICK_MOVE', 'Drag threshold', 'Screen px: moving farther than this is a drag, not a click', 8, 1, 40),
            D('drag-wake', 'DRAG_WAKE', 'Drag wave strength', '0 = no wake when dragging across the water', 0.18, 0, 1, 0.02),
            I('drag-spacing', 'DRAG_SPACING', 'Wake point spacing', 'Pond px, along the drag path', 7, 2, 30),
            I('drag-max', 'DRAG_MAX', 'Maximum wake points per move', '', 14, 1, 40),
            B('debug-click', 'DEBUG_CLICK', 'Log clicks', 'View with journalctl -f -o cat /usr/bin/gnome-shell', false),
        ],
    },
    {
        id: 'leaves', title: 'Fallen Leaves', icon: 'weather-windy-symbolic',
        desc: 'Leaves fall, drift, soak up water, sink and settle on the bottom.',
        rows: [
            I('leaf-spawn-min', 'LEAF_SPAWN_MIN', 'Leaf fall interval: shortest', 'Seconds between two random leaf falls', 60, 5, 3600, 5),
            I('leaf-spawn-max', 'LEAF_SPAWN_MAX', 'Leaf fall interval: longest', 'Seconds', 300, 5, 7200, 5),
            I('leaf-extra', 'LEAF_EXTRA', 'Extra leaves allowed', 'How many leaves may exceed the fallen-leaf count', 1, 0, 10),
            I('leaf-per-pad', 'LEAF_PER_PAD', 'Maximum leaves per lily pad', '', 3, 0, 10),
            I('leaf-fall-height', 'LEAF_FALL_HEIGHT', 'Starting fall height', '', 70, 20, 200, 5),
            D('leaf-sink-chance', 'LEAF_SINK_CHANCE', 'Chance to sink on landing', '0..1', 0.35, 0, 1, 0.05),
            D('leaf-sink-time', 'LEAF_SINK_TIME', 'Sinking time', 'Seconds from the start of sinking until reaching the bottom', 3.5, 0.5, 15, 0.5),
            D('leaf-drag', 'LEAF_DRAG', 'Water drag', 'Higher = less sliding, stops faster', 5.5, 0.5, 20, 0.5),
            D('leaf-soak-wave', 'LEAF_SOAK_WAVE', 'Soaking from waves', 'Higher = even small waves sink leaves quickly', 6, 0, 30, 0.5),
            D('leaf-soak-fish', 'LEAF_SOAK_FISH', 'Soaking from fish near the surface', '', 1.5, 0, 10, 0.1),
            D('leaf-soak-bump', 'LEAF_SOAK_BUMP', 'Soaking from collisions', '', 0.5, 0, 2, 0.05),
            D('leaf-soak-held', 'LEAF_SOAK_HELD', 'Soaking while dragged', '', 0.25, 0, 2, 0.05),
            D('leaf-dry', 'LEAF_DRY', 'Drying speed', 'When the water is completely calm', 0.03, 0, 0.5, 0.01),
            I('leaf-float-min', null, 'Float time before sinking: shortest', 'Seconds (a leaf soaks through and sinks after about this long)', 1800, 60, 14400, 60),
            I('leaf-float-max', null, 'Float time before sinking: longest', 'Seconds', 3600, 60, 14400, 60),
            I('leaf-bed-max', 'LEAF_BED_MAX', 'Maximum leaves on the bottom', 'Beyond this the oldest leaf fades away', 40, 0, 200),
            D('leaf-bed-alpha', 'LEAF_BED_ALPHA', 'Bottom leaf opacity', '', 0.7, 0.1, 1, 0.05),
            D('leaf-bed-kick', 'LEAF_BED_KICK', 'Fish stirring strength on the bottom', 'Higher = leaves get thrown farther', 9, 0, 40, 0.5),
            D('leaf-bed-damp', 'LEAF_BED_DAMP', 'Bottom friction', 'Higher = leaves stop faster', 4, 0.5, 20, 0.5),
            I('fish-bed-z', 'FISH_BED_Z', 'Height at which fish still stir leaves', 'A fish must be this close to the bottom', 10, 1, 50),
        ],
    },
    {
        id: 'fish', title: 'Koi', icon: 'emblem-favorite-symbolic',
        desc: 'Fish behaviour.',
        rows: [
            D('fish-avoid', 'FISH_AVOID', 'Avoidance look-ahead', 'Multiple of body length; 0 = no avoidance', 3.5, 0, 8, 0.1),
            I('fish-act-min', 'FISH_ACT_MIN', 'Behaviour change: shortest', 'Seconds', 10, 2, 60),
            I('fish-act-max', 'FISH_ACT_MAX', 'Behaviour change: longest', 'Seconds', 24, 2, 120),
            D('fish-turn', 'FISH_TURN', 'Maximum turn rate', 'rad/s', 3.2, 0.5, 8, 0.1),
            D('fish-depth-tint', 'FISH_DEPTH_TINT', 'Deep fish look darker / bluer', '0 = off', 0.3, 0, 1, 0.05),
            D('fish-hit', 'FISH_HIT', 'Body hardness', 'Smaller = fish may glide closer past each other', 0.9, 0.3, 1.5, 0.05),
        ],
    },
    {
        id: 'pads', title: 'Lily Pads', icon: 'emblem-ok-symbolic',
        desc: 'Collisions and reaction to waves.',
        rows: [
            D('pad-gap', 'PAD_GAP', 'Minimum gap between pads', 'Multiple of the sum of the radii', 1.06, 1, 2, 0.01),
            D('pad-rest', 'PAD_REST', 'Bounciness on contact', '0 = stick together', 0.06, 0, 1, 0.02),
            D('pad-friction', 'PAD_FRICTION', 'Edge friction', '', 0.35, 0, 1, 0.05),
            D('leaf-wash', 'LEAF_WASH', 'Wave height that washes leaves off a pad', '', 0.14, 0.02, 0.5, 0.01),
            I('wave-push-pad', 'WAVE_PUSH_PAD', 'Maximum speed waves push a pad', '', 45, 0, 150),
            I('wave-push-leaf', 'WAVE_PUSH_LEAF', 'Maximum speed waves push a fallen leaf', '', 35, 0, 150),
        ],
    },
];
