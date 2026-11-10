// Koi Pond Wallpaper (pixel art) - GNOME Shell 45-49

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Cairo from 'cairo';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WindowPreview from 'resource:///org/gnome/shell/ui/windowPreview.js';

import {SCHEMA_ID, SPEC} from './settings-spec.js';
import {FISH_DIR, scanFishDir, parseCounts, DEFAULT_COUNT, MAX_PER_FILE} from './fish-files.js';

// ───────────── Giá trị mặc định ─────────────
// Các giá trị dưới đây chỉ là mặc định. Chỉnh trong hộp Cài đặt của extension (prefs);
// bảng đầy đủ nằm ở settings-spec.js. Khi chạy, giá trị thật được đọc từ GSettings (xem applySettings).
let FPS_MIN = 5;           // FPS khi mọi thứ trôi chậm / yên tĩnh (càng thấp càng nhẹ)
let FPS_MAX = 40;          // FPS vẽ khi đang kéo, hoặc lá / sóng đang chuyển động (mô phỏng không còn phụ thuộc FPS nên tăng thoải mái)
let ACTIVE_SPEED = 40;     // lá trôi nhanh cỡ này (px ao/giây, x u) thì chạy FPS_MAX
let PIXEL_SIZE = 4;        // mỗi "pixel" = N pixel màn hình (3 = mịn hơn, 6 = thô hơn)
let FISH_COUNT = 7;
let FISH_USE_CUSTOM = false;     // true = dùng file trong fish/ thay cho cá vẽ bằng code
let FISH_CUSTOM_COUNTS = '{}';   // JSON {"loài/file": số con}
let PAD_COUNT = 6;         // số lá sen
let RIPPLE_LIFE = 3.4;     // giây

// Mô phỏng sóng nước thật (phương trình sóng 2D trên lưới độ cao)
let WAVE_CELL = 2;         // 1 ô sóng = N pixel của ao. 1 = mịn hơn nhưng nặng gấp ~4 lần
let WAVE_STEP_RATE = 40;   // số bước mô phỏng/giây (tốc độ sóng ~ 27 ô/giây)
let WAVE_C2 = 0.3;         // (tốc độ sóng)^2 mỗi bước, phải < 0.5 để ổn định
let WAVE_DAMP = 0.006;     // sóng tắt dần mỗi bước (lớn hơn = sóng tàn nhanh hơn)
const WAVE_SPONGE = 6;       // số ô ở mép hút sóng, để sóng không dội ngược lại từ mép màn hình
let WAVE_DROP = 2.0;       // độ mạnh của một giọt/click
let PHYS_DT = 1 / WAVE_STEP_RATE;   // bước mô phỏng CỐ ĐỊNH (giây): 1 bước vật lý = 1 bước sóng, không phụ thuộc FPS vẽ
// Sóng đẩy vật nổi: sóng quyết định "vận tốc mà vật bị cuốn theo" (mượt, bão hoà mềm), vật bám theo bằng quán tính
// của nước. Giao thoa vẫn cộng độ cao sóng đúng; chỉ là nhiều sóng chồng nhau không còn gia tốc vật lên vô hạn.
let WAVE_PUSH_PAD = 45;    // vận tốc tối đa (x u, px ao/giây) mà sóng có thể cuốn lá sen đi
let WAVE_PUSH_LEAF = 35;   // như trên, cho lá rụng (nước hãm nên không bị cuốn đi quá nhanh)
const WAVE_PUSH_GAIN_PAD = 400;    // sóng yếu: vận tốc cuốn = hệ số này x độ dốc sóng (x u); lớn hơn = nhạy hơn
const WAVE_PUSH_GAIN_LEAF = 500;
const WAVE_PUSH_TAU = 0.12;  // giây: độ trễ làm mượt vận tốc cuốn (nhỏ = phản ứng gắt hơn)
const WAVE_REST = 0.008;     // dưới ngưỡng này coi như mặt nước phẳng, ngừng tính
const WAVE_T1 = 0.10;        // ngưỡng tô sáng/tối đậm
const WAVE_T2 = 0.04;        // ngưỡng tô sáng/tối nhạt

// Giờ trong ngày
let TIME_OVERRIDE = null;  // ví dụ 18.5 = luôn là 18:30 (để xem thử); null = dùng giờ thật của máy
let TIME_SPEED = 1;        // 1 = giờ thật; 600 = một ngày trôi qua trong ~2.4 phút (để xem thử)
let AMBIENT_DROPS = false;  // thỉnh thoảng có giọt mưa nhỏ tự rơi (vẽ cả giọt đang rơi xuống)
let GLITTER = false;       // false = tắt các điểm lấp lánh trên mặt nước
let GLARE = false;         // quầng sáng mờ cũ (true = bật lại). Tự dùng làm dự phòng nếu thiếu file PNG
let CELESTIAL = true;      // true = vẽ ảnh PNG mặt trời / mặt trăng (thư mục sun/ và moon/) thay cho quầng sáng
const SUN_DIR = 'sun';       // thư mục ảnh mặt trời, nằm cạnh extension.js
const MOON_DIR = 'moon';     // thư mục ảnh mặt trăng (các pha, xếp theo tên: ảnh đầu = trăng non, giữa = trăng rằm)
let SUN_SIZE = 0.12;       // chiều lớn nhất của ảnh mặt trời = bấy nhiêu lần chiều rộng màn hình
let MOON_SIZE = 0.09;      // như trên, cho mặt trăng
let CELESTIAL_OPACITY = 1.0;
let GLOW = true;               // quầng sáng (glow) quanh mặt trời / mặt trăng
let GLOW_SIZE = 2.6;           // đường kính glow = bấy nhiêu lần kích thước ảnh
let GLOW_OPACITY = 0.40;       // độ đậm glow ở tâm (0..1)
let SHIMMER = 1.0;             // độ rung lăn tăn của bóng khi nước lặng (0 = đứng yên khi không có sóng)
let WAVE_DISTORT = 40;         // sóng làm méo / vỡ bóng mạnh cỡ nào (lớn hơn = vỡ nhiều hơn)
let REFLECT_SEG = 8;           // bóng bị cắt thành các mảnh rộng bấy nhiêu pixel ao (nhỏ = vỡ mịn hơn nhưng nặng hơn)
let CELESTIAL_ON_TOP = true;   // true = vẽ sau cùng (sáng rõ, nằm trên lá sen); false = nằm dưới lá sen và bị tối theo màu giờ
let MOON_UP_HOURS = 12;    // mặt trăng ở trên trời bao nhiêu tiếng mỗi lần mọc
let NEW_MOON_HIDDEN = true;    // ngày không trăng (trăng non) thì không vẽ gì
let MOON_AGE_OVERRIDE = null;  // xem thử pha trăng: 0 = non, 7.4 = thượng huyền, 14.8 = rằm, 22.1 = hạ huyền; null = dùng ngày thật
let WATER_OPACITY = 1.0;   // <1 để thấy hình nền gốc xuyên qua
let DEBUG_CLICK = false;   // true: ghi log mỗi lần click (xem bằng journalctl -f -o cat /usr/bin/gnome-shell)
let CLICK_MS = 250;        // nhả chuột trong bấy nhiêu ms và gần như không di chuyển thì mới tính là click
let CLICK_MOVE = 8;        // px màn hình: di chuyển quá bấy nhiêu thì coi là kéo, không phải click
let DRAG_WAKE = 0.18;      // giữ chuột trái kéo trên nền: độ mạnh sóng mỗi điểm dọc đường kéo (0 = tắt)
let DRAG_SPACING = 7;      // px ao: khoảng cách giữa hai điểm sóng dọc đường kéo
let DRAG_MAX = 14;         // tối đa bấy nhiêu điểm sóng mỗi lần chuột di chuyển
let FLOW_SPEED = 12;       // tốc độ dòng nước (lá và rong trôi theo), 0 = nước đứng yên
let LEAF_COUNT = 9;        // số lá rụng nhỏ trôi trên mặt nước
let WEED_COUNT = 7;        // số cụm rong dưới đáy
let LAYOUT_SEED = 0;         // hạt giống bố cục ao: cùng số = cùng bố cục

// Va chạm giữa các vật nổi (lá sen với nhau, lá rụng với nhau, lá rụng với lá sen)
let PAD_GAP = 1.06;        // hai lá sen không được gần hơn bấy nhiêu lần tổng bán kính (chừa chỗ cho lúc lá phồng lên)
let PAD_REST = 0.06;       // độ nảy khi hai lá sen chạm nhau (0 = dính vào nhau)
let PAD_FRICTION = 0.35;   // ma sát ở mép lá sen
const LEAF_REST = 0.08;      // độ nảy khi hai lá rụng chạm nhau (lá bám nước nên gần như không nảy)
const LEAF_FRICTION = 0.55;  // lá rụng bám mặt nước nên trượt lên nhau bị hãm
let LEAF_PER_PAD = 3;      // tối đa bấy nhiêu lá rụng đậu trên một lá sen
let LEAF_WASH = 0.14;      // biên độ sóng đủ đánh văng lá khỏi mặt lá sen
const LEAF_HEIGHT = 3.0;     // lá nằm trên lá sen cao hơn mặt nước bấy nhiêu (×u) — dùng cho bóng đổ
const LEAF_SPLASH = 0.07;    // sóng nhỏ toé ra khi lá rơi xuống nước / bị văng khỏi lá sen

// Lá rụng: rơi từ trên xuống, có tỉ lệ chìm, thỉnh thoảng rơi ngẫu nhiên
let LEAF_SPAWN_MIN = 60;    // giây: khoảng cách ngắn nhất giữa hai lá rơi ngẫu nhiên (1 phút)
let LEAF_SPAWN_MAX = 300;   // giây: khoảng cách dài nhất (5 phút)
let LEAF_EXTRA = 1;         // cho phép nhiều hơn LEAF_COUNT tối đa bấy nhiêu lá
let LEAF_FALL_HEIGHT = 70;  // độ cao lúc bắt đầu rơi (×u)
const LEAF_FALL_GRAVITY = 60; // gia tốc rơi (×u px/giây²)
let LEAF_SINK_CHANCE = 0.35; // tỉ lệ lá chìm ngay khi chạm mặt nước

// Lá rụng trên mặt nước rất nhẹ và mỏng: nước hãm rất mạnh (không trượt/quán tính), nhưng chỉ cần một tác động
// nhỏ là lá ngấm nước ("soak" 0..1) rồi chìm. Soak tăng khi có sóng, cá trồi sát mặt, va chạm, bị kéo.
let LEAF_DRAG = 5.5;        // 1/giây: nước hãm vận tốc lá về vận tốc dòng nước (lớn hơn = ít trơn trượt, dừng nhanh)
const LEAF_SOAK_MIN = 0.015;  // biên độ sóng nhỏ hơn mức này thì không làm lá ngấm nước
let LEAF_SOAK_WAVE = 6;     // soak/giây mỗi đơn vị biên độ sóng vượt ngưỡng (sóng 0.1 => ~0.5/giây)
let LEAF_SOAK_FISH = 1.5;   // soak/giây khi cá trồi sát mặt bơi ngay dưới lá
let LEAF_SOAK_BUMP = 0.5;   // soak tối đa cộng thêm cho mỗi cú va chạm mạnh
let LEAF_SOAK_HELD = 0.25;  // soak/giây khi bị chuột kéo lê trên nước
let LEAF_DRY = 0.03;        // soak/giây tự giảm khi nước hoàn toàn lặng (lá khô dần)
const LEAF_FISH_TOP = 14;     // (x u) cá có mặt trên cách mặt nước ít hơn mức này thì khuấy được lá trên mặt
let LEAF_SINK_TIME = 3.5;   // giây: chìm hẳn xuống dưới mặt nước
let LEAF_FLOAT_LIFE = [1800, 3600]; // giây (30-60 phút): trôi lâu thì ngấm nước rồi chìm

// Lá đã chìm: nằm yên dưới đáy, chỉ cá ở tầng sát đáy bơi qua mới làm lá bị tung / xoay / trượt
let LEAF_BED_MAX = 40;      // tối đa bấy nhiêu lá nằm dưới đáy; quá số này thì lá cũ nhất mờ dần rồi biến mất
let LEAF_BED_ALPHA = 0.7;   // độ đậm của lá nằm dưới đáy
const LEAF_BED_MIX = 0.7;     // mức ngả màu nước của lá dưới đáy (0 = giữ màu lá, 1 = hoà hẳn vào nước)
let LEAF_BED_KICK = 9;      // độ mạnh cá khuấy lá (lớn hơn = lá bị tung xa hơn)
let LEAF_BED_DAMP = 4;      // ma sát dưới đáy: lớn hơn = lá dừng nhanh hơn
let FISH_BED_Z = 10;        // (x u) cá có độ cao đáy thấp hơn mức này mới khuấy được lá dưới đáy

// <<settings-setters (generated by tools/gen.mjs, do not edit by hand)
const SETTERS = {
    'fps-min': v => { FPS_MIN = v; },
    'fps-max': v => { FPS_MAX = v; },
    'active-speed': v => { ACTIVE_SPEED = v; },
    'pixel-size': v => { PIXEL_SIZE = v; },
    'water-opacity': v => { WATER_OPACITY = v; },
    'fish-count': v => { FISH_COUNT = v; },
    'pad-count': v => { PAD_COUNT = v; },
    'leaf-count': v => { LEAF_COUNT = v; },
    'weed-count': v => { WEED_COUNT = v; },
    'layout-seed': v => { LAYOUT_SEED = v; },
    'time-speed': v => { TIME_SPEED = v; },
    'celestial': v => { CELESTIAL = v; },
    'sun-size': v => { SUN_SIZE = v; },
    'moon-size': v => { MOON_SIZE = v; },
    'celestial-opacity': v => { CELESTIAL_OPACITY = v; },
    'celestial-on-top': v => { CELESTIAL_ON_TOP = v; },
    'glow': v => { GLOW = v; },
    'glow-size': v => { GLOW_SIZE = v; },
    'glow-opacity': v => { GLOW_OPACITY = v; },
    'shimmer': v => { SHIMMER = v; },
    'wave-distort': v => { WAVE_DISTORT = v; },
    'reflect-seg': v => { REFLECT_SEG = v; },
    'moon-up-hours': v => { MOON_UP_HOURS = v; },
    'new-moon-hidden': v => { NEW_MOON_HIDDEN = v; },
    'flow-speed': v => { FLOW_SPEED = v; },
    'ambient-drops': v => { AMBIENT_DROPS = v; },
    'glitter': v => { GLITTER = v; },
    'glare': v => { GLARE = v; },
    'wave-drop': v => { WAVE_DROP = v; },
    'wave-damp': v => { WAVE_DAMP = v; },
    'wave-cell': v => { WAVE_CELL = v; },
    'wave-step-rate': v => { WAVE_STEP_RATE = v; },
    'wave-c2': v => { WAVE_C2 = v; },
    'ripple-life': v => { RIPPLE_LIFE = v; },
    'click-ms': v => { CLICK_MS = v; },
    'click-move': v => { CLICK_MOVE = v; },
    'drag-wake': v => { DRAG_WAKE = v; },
    'drag-spacing': v => { DRAG_SPACING = v; },
    'drag-max': v => { DRAG_MAX = v; },
    'debug-click': v => { DEBUG_CLICK = v; },
    'leaf-spawn-min': v => { LEAF_SPAWN_MIN = v; },
    'leaf-spawn-max': v => { LEAF_SPAWN_MAX = v; },
    'leaf-extra': v => { LEAF_EXTRA = v; },
    'leaf-per-pad': v => { LEAF_PER_PAD = v; },
    'leaf-fall-height': v => { LEAF_FALL_HEIGHT = v; },
    'leaf-sink-chance': v => { LEAF_SINK_CHANCE = v; },
    'leaf-sink-time': v => { LEAF_SINK_TIME = v; },
    'leaf-drag': v => { LEAF_DRAG = v; },
    'leaf-soak-wave': v => { LEAF_SOAK_WAVE = v; },
    'leaf-soak-fish': v => { LEAF_SOAK_FISH = v; },
    'leaf-soak-bump': v => { LEAF_SOAK_BUMP = v; },
    'leaf-soak-held': v => { LEAF_SOAK_HELD = v; },
    'leaf-dry': v => { LEAF_DRY = v; },
    'leaf-bed-max': v => { LEAF_BED_MAX = v; },
    'leaf-bed-alpha': v => { LEAF_BED_ALPHA = v; },
    'leaf-bed-kick': v => { LEAF_BED_KICK = v; },
    'leaf-bed-damp': v => { LEAF_BED_DAMP = v; },
    'fish-bed-z': v => { FISH_BED_Z = v; },
    'fish-use-custom': v => { FISH_USE_CUSTOM = v; },
    'fish-custom-counts': v => { FISH_CUSTOM_COUNTS = v; },
    'fish-avoid': v => { FISH_AVOID = v; },
    'fish-act-min': v => { FISH_ACT_MIN = v; },
    'fish-act-max': v => { FISH_ACT_MAX = v; },
    'fish-turn': v => { FISH_TURN = v; },
    'fish-depth-tint': v => { FISH_DEPTH_TINT = v; },
    'fish-hit': v => { FISH_HIT = v; },
    'pad-gap': v => { PAD_GAP = v; },
    'pad-rest': v => { PAD_REST = v; },
    'pad-friction': v => { PAD_FRICTION = v; },
    'leaf-wash': v => { LEAF_WASH = v; },
    'wave-push-pad': v => { WAVE_PUSH_PAD = v; },
    'wave-push-leaf': v => { WAVE_PUSH_LEAF = v; },
};
// settings-setters>>

// Giá trị ghép từ nhiều khoá (xử lý riêng, không có biến cùng tên)
const SP = {timeEn: false, timeHr: 18.5, moonEn: false, moonAge: 14.8, floatMin: 1800, floatMax: 3600};
const SPECIAL = {
    'time-override-enabled': v => { SP.timeEn = v; },
    'time-override-hour': v => { SP.timeHr = v; },
    'moon-age-override-enabled': v => { SP.moonEn = v; },
    'moon-age': v => { SP.moonAge = v; },
    'leaf-float-min': v => { SP.floatMin = v; },
    'leaf-float-max': v => { SP.floatMax = v; },
};
const SETTING_ROWS = new Map();     // key => dòng đặc tả
for (const g of SPEC) {
    for (const r of g.rows)
        SETTING_ROWS.set(r.key, r);
}

// Đọc toàn bộ cài đặt từ GSettings vào các biến cấu hình ở trên
function applySettings(settings) {
    for (const [key, r] of SETTING_ROWS) {
        const v = r.type === 'bool' ? settings.get_boolean(key)
            : r.type === 'int' ? settings.get_int(key)
                : r.type === 'string' ? settings.get_string(key)
                    : settings.get_double(key);
        (SETTERS[key] ?? SPECIAL[key])?.(v);
    }
    TIME_OVERRIDE = SP.timeEn ? SP.timeHr : null;
    MOON_AGE_OVERRIDE = SP.moonEn ? SP.moonAge : null;
    LEAF_FLOAT_LIFE = [Math.min(SP.floatMin, SP.floatMax), Math.max(SP.floatMin, SP.floatMax)];
    if (LEAF_SPAWN_MAX < LEAF_SPAWN_MIN)
        LEAF_SPAWN_MAX = LEAF_SPAWN_MIN;
    if (FISH_ACT_MAX < FISH_ACT_MIN)
        FISH_ACT_MAX = FISH_ACT_MIN;
    if (FPS_MAX < FPS_MIN)
        FPS_MAX = FPS_MIN;
    WAVE_C2 = Math.min(WAVE_C2, 0.49);
    PHYS_DT = 1 / WAVE_STEP_RATE;
    _frameCache.clear();
    FISH_ROSTER = FISH_USE_CUSTOM ? buildFishRoster() : [];
}

let ASSET_DIR = null;            // thư mục extension, gán trong enable()
const _imgCache = new Map();     // đường dẫn => Cairo.ImageSurface (hoặc null nếu không đọc được)
const _frameCache = new Map();   // tên thư mục => danh sách đường dẫn PNG đã sắp xếp theo tên

// Liệt kê các file .png trong thư mục con, sắp xếp theo tên (số tự nhiên: moon_2 trước moon_10)
function listFrames(sub) {
    if (_frameCache.has(sub))
        return _frameCache.get(sub);
    const names = [];
    try {
        const dir = Gio.File.new_for_path(GLib.build_filenamev([ASSET_DIR, sub]));
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            const n = info.get_name();
            if (n.toLowerCase().endsWith('.png'))
                names.push(n);
        }
        en.close(null);
    } catch (e) {
        log(`koipond: không đọc được thư mục ${sub}/ (${e.message})`);
    }
    names.sort((x, y) => x.localeCompare(y, undefined, {numeric: true}));
    const paths = names.map(n => GLib.build_filenamev([ASSET_DIR, sub, n]));
    _frameCache.set(sub, paths);
    return paths;
}

function getImage(path) {
    if (_imgCache.has(path))
        return _imgCache.get(path);
    let surf = null;
    try {
        surf = Cairo.ImageSurface.createFromPNG(path);
    } catch (e) {
        logError(e, `koipond load ${path}`);
    }
    _imgCache.set(path, surf);
    return surf;
}

// ───────────── Pha trăng ─────────────
const SYNODIC = 29.530588853;     // một tháng trăng (ngày)
const NEW_MOON_REF = 947182440;   // một ngày trăng non đã biết: 06/01/2000 18:14 UTC (giây Unix)

// Tuổi trăng hôm nay: 0 = non, ~7.4 = thượng huyền, ~14.8 = rằm, ~22.1 = hạ huyền
function moonAge() {
    if (MOON_AGE_OVERRIDE !== null)
        return MOON_AGE_OVERRIDE;
    const now = GLib.get_real_time() / 1e6;
    return ((((now - NEW_MOON_REF) / 86400) % SYNODIC) + SYNODIC) % SYNODIC;
}

const TAU = Math.PI * 2;
// ── Bộ sinh số ngẫu nhiên có hạt giống (seed) ──
// Khi dựng ao, dùng withSeed(...) để cùng một seed luôn cho ra cùng một bố cục.
// Ngoài lúc dựng (lúc chạy), _rng vẫn là Math.random nên chuyển động vẫn tự nhiên.
let _rng = Math.random;
function mulberry32(a) {
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Trộn nhiều số nguyên / chuỗi thành một seed 32-bit
function hashSeed(...parts) {
    let h = 2166136261;
    for (const p of parts) {
        const str = String(p);
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        h ^= 0xff;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function withSeed(seed, fn) {
    const prev = _rng;
    _rng = mulberry32(seed);
    try {
        return fn();
    } finally {
        _rng = prev;
    }
}
const rand = (a, b) => a + _rng() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const lw = v => Math.max(1, v);   // độ dày nét tối thiểu 1 pixel (vì tắt khử răng cưa)

// ───────────── Hình học va chạm ─────────────
// Điểm trên đoạn AB gần P nhất.
function closestPointOnSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return [ax + dx * t, ay + dy * t];
}

// Cặp điểm gần nhau nhất của hai đoạn thẳng (dùng cho lá rụng dạng "viên thuốc").
// Trả về khoảng cách, hai điểm và pháp tuyến đơn vị hướng từ đoạn 1 sang đoạn 2.
function closestOnSegments(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const rx = ax - cx, ry = ay - cy;
    const a = d1x * d1x + d1y * d1y;
    const e = d2x * d2x + d2y * d2y;
    const f = d2x * rx + d2y * ry;
    const EPS = 1e-9;
    let s, t;
    if (a <= EPS && e <= EPS) {
        s = 0; t = 0;
    } else if (a <= EPS) {
        s = 0; t = clamp(f / e, 0, 1);
    } else {
        const c = d1x * rx + d1y * ry;
        if (e <= EPS) {
            t = 0; s = clamp(-c / a, 0, 1);
        } else {
            const b = d1x * d2x + d1y * d2y;
            const den = a * e - b * b;
            s = den > EPS ? clamp((b * f - c * e) / den, 0, 1) : 0;
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0; s = clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1; s = clamp((b - c) / a, 0, 1);
            }
        }
    }
    const px = ax + d1x * s, py = ay + d1y * s;
    const qx = cx + d2x * t, qy = cy + d2y * t;
    let nx = qx - px, ny = qy - py;
    let d = Math.hypot(nx, ny);
    if (d < 1e-7) {
        nx = 1; ny = 0; d = 0;
    } else {
        nx /= d; ny /= d;
    }
    return {d, px, py, qx, qy, nx, ny};
}

// Giải một điểm tiếp xúc giữa hai vật nổi: đẩy rời nhau theo pháp tuyến, đổi vận tốc
// có độ nảy + ma sát + xoay quanh điểm chạm (mô men quán tính). n hướng từ a sang b.
function resolveContact(a, b, nx, ny, pen, cx, cy, rest, mu) {
    const ima = a.invMass, imb = b.invMass;
    const tot = ima + imb;
    if (tot <= 0)
        return;

    // tách chỗ chồng (trừ một khoảng lún nhỏ để không rung khi nằm yên)
    const corr = Math.max(0, pen - 0.3) * 0.7;
    if (corr > 0) {
        a.x -= nx * corr * ima / tot;
        a.y -= ny * corr * ima / tot;
        b.x += nx * corr * imb / tot;
        b.y += ny * corr * imb / tot;
    }

    const rax = cx - a.x, ray = cy - a.y;
    const rbx = cx - b.x, rby = cy - b.y;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0)
        return;   // hai vật đang rời nhau

    const ran = rax * ny - ray * nx;
    const rbn = rbx * ny - rby * nx;
    const kn = tot + ran * ran * a.invI + rbn * rbn * b.invI;
    const j = -(1 + rest) * vn / kn;
    a.vx -= j * nx * ima; a.vy -= j * ny * ima; a.av -= j * ran * a.invI;
    b.vx += j * nx * imb; b.vy += j * ny * imb; b.av += j * rbn * b.invI;

    // ma sát: lá nổi bám mặt nước nên trượt trên nhau cũng bị hãm
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const rat = rax * ty - ray * tx;
    const rbt = rbx * ty - rby * tx;
    const kt = tot + rat * rat * a.invI + rbt * rbt * b.invI;
    const jt = clamp(-vt / kt, -mu * Math.abs(j), mu * Math.abs(j));
    a.vx -= jt * tx * ima; a.vy -= jt * ty * ima; a.av -= jt * rat * a.invI;
    b.vx += jt * tx * imb; b.vy += jt * ty * imb; b.av += jt * rbt * b.invI;
}

// ───────────── Ánh sáng theo giờ trong ngày ─────────────
// amb = màu nhân lên toàn cảnh (tối dần về đêm, ám cam lúc chiều tà)
// lc  = màu ánh sáng chiếu lên mặt nước (vệt sáng, lấp lánh), ls = độ mạnh (0..1)
const SUNRISE = 5.5;
const SUNSET = 19.0;
const SKY = [
    {h: 0.0,  amb: [0.36, 0.44, 0.68], lc: [0.78, 0.88, 1.00], ls: 0.55},   // đêm (trăng)
    {h: 4.5,  amb: [0.38, 0.46, 0.70], lc: [0.78, 0.88, 1.00], ls: 0.50},
    {h: 5.5,  amb: [0.58, 0.52, 0.72], lc: [0.90, 0.70, 0.80], ls: 0.15},   // trăng lặn, mặt trời chưa lên
    {h: 6.5,  amb: [0.95, 0.72, 0.64], lc: [1.00, 0.72, 0.50], ls: 0.75},   // bình minh
    {h: 8.0,  amb: [1.00, 0.93, 0.84], lc: [1.00, 0.94, 0.82], ls: 0.90},   // sáng
    {h: 10.0, amb: [1.00, 0.99, 0.96], lc: [1.00, 1.00, 0.95], ls: 1.00},
    {h: 12.5, amb: [1.00, 1.00, 1.00], lc: [1.00, 1.00, 1.00], ls: 1.00},   // trưa
    {h: 15.0, amb: [1.00, 0.98, 0.92], lc: [1.00, 0.96, 0.85], ls: 0.95},   // chiều
    {h: 17.0, amb: [1.00, 0.86, 0.68], lc: [1.00, 0.80, 0.50], ls: 0.90},   // nắng vàng
    {h: 18.3, amb: [0.97, 0.62, 0.45], lc: [1.00, 0.58, 0.32], ls: 0.80},   // hoàng hôn
    {h: 19.0, amb: [0.70, 0.48, 0.58], lc: [0.90, 0.50, 0.45], ls: 0.15},   // mặt trời lặn
    {h: 19.8, amb: [0.40, 0.42, 0.64], lc: [0.75, 0.82, 1.00], ls: 0.45},   // chập tối, trăng lên
    {h: 21.0, amb: [0.36, 0.44, 0.68], lc: [0.78, 0.88, 1.00], ls: 0.55},
    {h: 24.0, amb: [0.36, 0.44, 0.68], lc: [0.78, 0.88, 1.00], ls: 0.55},
];

const mix3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

function lightAt(hour) {
    hour = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < SKY.length - 2 && hour >= SKY[i + 1].h)
        i++;
    const a = SKY[i], b = SKY[i + 1];
    const f = (hour - a.h) / (b.h - a.h);

    // nguồn sáng (mặt trời ban ngày, mặt trăng ban đêm) đi từ trái qua dưới sang phải màn hình:
    // đông = trái, nam = dưới, tây = phải
    const day = hour >= SUNRISE && hour < SUNSET;
    const dayLen = SUNSET - SUNRISE;
    const k = day
        ? (hour - SUNRISE) / dayLen
        : ((hour >= SUNSET ? hour - SUNSET : hour + 24 - SUNSET) / (24 - dayLen));
    const phi = k * Math.PI;
    return {
        amb: mix3(a.amb, b.amb, f),
        lc: mix3(a.lc, b.lc, f),
        ls: a.ls + (b.ls - a.ls) * f,
        dx: -Math.cos(phi),
        dy: Math.sin(phi),
        elev: Math.sin(phi),     // 0 = sát đường chân trời, 1 = trên đỉnh đầu
        day,
    };
}

// ───────────── Cá tuỳ chỉnh (thư mục fish/) ─────────────
// Mỗi file trong fish/<loài>/ là một "khung xương" của một kiểu cá:
//  • .png  : ảnh cá nhìn từ trên xuống. Ảnh được cắt thành các lát dọc thân rồi uốn theo chuỗi đốt xương sống
//            của cá => bơi uốn lượn, có bóng, va chạm, né nhau như cá vẽ bằng code.
//  • .json : thông số của xương sống (độ to từng đốt, màu, đuôi, vây...) => vẫn vẽ bằng code nhưng theo thông số này.
//  • .png + .json cùng tên: JSON là tuỳ chọn cho ảnh (length, headOffset, facing, size...).
// Xem README.md để biết đầy đủ các trường.
const MAX_CUSTOM_FISH = 60;
let FISH_ROSTER = [];                // mỗi phần tử = định nghĩa cá của một con (cùng file => cùng đối tượng)
const _fishDefCache = new Map();     // id file => {sig, def}

const _jnum = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;

function _jrange(v, d, lo, hi) {
    if (typeof v === 'number' && Number.isFinite(v))
        return [Math.max(lo, Math.min(hi, v)), Math.max(lo, Math.min(hi, v))];
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        const a = Math.max(lo, Math.min(hi, v[0])), b = Math.max(lo, Math.min(hi, v[1]));
        return [Math.min(a, b), Math.max(a, b)];
    }
    return d;
}

// '#rrggbb' | '#rgb' | [r, g, b] (0..1 hoặc 0..255) => [r, g, b] 0..1, hoặc null nếu không hợp lệ
function _jcolor(v) {
    if (typeof v === 'string') {
        let h = v.trim().replace(/^#/, '');
        if (h.length === 3)
            h = h.split('').map(c => c + c).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(h))
            return null;
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    }
    if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(x => typeof x === 'number')) {
        const big = v.slice(0, 3).some(x => x > 1);
        return v.slice(0, 3).map(x => Math.max(0, Math.min(1, big ? x / 255 : x)));
    }
    return null;
}

// Co giãn mảng bán kính thân về đúng nseg đốt
function _resampleProfile(arr, nseg) {
    if (!Array.isArray(arr) || arr.length < 2 || !arr.every(x => typeof x === 'number' && Number.isFinite(x)))
        arr = PROFILE;
    return Array.from({length: nseg}, (_, i) => {
        const pos = i * (arr.length - 1) / (nseg - 1);
        const k = Math.min(arr.length - 2, Math.floor(pos));
        const v = arr[k] + (arr[k + 1] - arr[k]) * (pos - k);
        return Math.max(0.03, Math.min(2, v));
    });
}

// Xoay / lật ảnh về hướng nội bộ (đầu ở mép trái). facing = hướng đầu cá trong ảnh gốc.
function _orientSprite(src, facing, flip) {
    // Thuật toán uốn ảnh coi ĐẦU cá nằm ở mép TRÁI ảnh, nên ảnh khai báo "đầu quay sang phải" (mặc định) phải xoay 180°
    const turn = {left: 0, right: Math.PI, up: -Math.PI / 2, down: Math.PI / 2}[facing] ?? Math.PI;
    if (turn === 0 && !flip)
        return src;
    const w = src.getWidth(), h = src.getHeight();
    const quarter = Math.abs(Math.abs(turn) - Math.PI / 2) < 1e-6;
    const W = quarter ? h : w, H = quarter ? w : h;
    const out = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cc = new Cairo.Context(out);
    cc.translate(W / 2, H / 2);
    if (flip)
        cc.scale(1, -1);
    cc.rotate(turn);
    cc.translate(-w / 2, -h / 2);
    cc.setSourceSurface(src, 0, 0);
    cc.paint();
    cc.$dispose();
    return out;
}

function _readJson(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error('không đọc được file');
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || typeof o !== 'object' || Array.isArray(o))
        throw new Error('JSON phải là một object {...}');
    return o;
}

function loadFishDef(e) {
    let o = {};
    if (e.json) {
        try {
            o = _readJson(e.json);
        } catch (err) {
            log(`koipond: ${e.json}: ${err.message}`);
            if (!e.png)
                return null;
        }
    }
    const nseg = Math.round(_jnum(o.segments, SEG, 4, 40));      // số đốt xương sống của loài này
    const wave = (o.wave && typeof o.wave === 'object') ? o.wave : {};
    const def = {
        id: e.id,
        size: _jrange(o.size, [15, 24], 4, 80),
        speed: _jrange(o.speed, [38, 62], 5, 300),
        spacing: _jnum(o.spacing, 0.55, 0.1, 2),
        nseg,
        bend: _jnum(o.bend, FISH_BEND, 0.05, 1.2),               // rad: mỗi khớp gập tối đa
        waveAmp: _jnum(wave.amplitude, 0.10, 0, 1),              // biên độ sóng trườn (x size)
        waveStep: _jnum(wave.step, 0.8, 0, 3),                   // lệch pha giữa hai đốt liền nhau (nhỏ = sóng dài)
        waveSpeed: _jnum(wave.speed, 1, 0.1, 5),                 // nhân tốc độ chạy của sóng
        profile: _resampleProfile(o.profile, nseg),
    };

    if (e.png) {
        let img = null;
        try {
            img = Cairo.ImageSurface.createFromPNG(e.png);
            if (!img.getWidth() || !img.getHeight())
                img = null;
        } catch (err) {
            log(`koipond: ${e.png}: ${err.message}`);
        }
        if (!img)
            return null;
        def.kind = 'sprite';
        def.img = _orientSprite(img, String(o.facing ?? 'right').toLowerCase(), !!o.flip);
        def.length = _jnum(o.length, 6.4, 2, 60);          // tổng chiều dài ảnh = bấy nhiêu lần "size" của cá
        def.headOff = _jnum(o.headOffset, 0.5, 0, 3);      // mũi cá nhô ra trước đốt đầu bấy nhiêu (x size)
        def.strips = Math.round(_jnum(o.strips, 16, 3, 64));   // số lát cắt ảnh dọc thân
        def.tailSwing = _jnum(o.tailSwing, 0.35, 0, 1.5);  // độ ngoe nguẩy của phần đuôi
        return def;
    }

    def.kind = 'skeleton';
    const cols = Array.isArray(o.colors) ? o.colors.map(_jcolor).filter(Boolean) : [];
    def.colors = cols.length ? cols : null;                 // null = dùng PALETTES theo chỉ số
    def.accentChance = _jnum(o.accentChance, 0.4, 0, 1);
    def.segColors = Array.isArray(o.segmentColors) ? o.segmentColors : null;   // chỉ số màu cho từng đốt
    const tail = (o.tail && typeof o.tail === 'object') ? o.tail : {};
    def.tailLen = _jnum(tail.length, 1.5, 0.2, 4);
    def.tailSpread = _jnum(tail.spread, 0.5, 0, 1.5);
    def.tailAlpha = _jnum(tail.alpha, 0.6, 0, 1);
    const fins = (o.fins && typeof o.fins === 'object') ? o.fins : {};
    def.finSize = _jnum(fins.size, 0.55, 0, 2);
    def.finWidth = _jnum(fins.width, 0.2, 0.02, 1);
    def.finAlpha = _jnum(fins.alpha, 0.55, 0, 1);
    def.eye = _jnum(o.eye, 0.07, 0, 0.3);
    return def;
}

function getFishDef(e) {
    const c = _fishDefCache.get(e.id);
    if (c && c.sig === e.sig)
        return c.def;
    let def = null;
    try {
        def = loadFishDef(e);
    } catch (err) {
        logError(err, `koipond fish ${e.id}`);
    }
    _fishDefCache.set(e.id, {sig: e.sig, def});
    return def;
}

// Quét fish/ và nhân mỗi file theo số con người dùng chọn (mặc định 1 con / file)
function buildFishRoster() {
    let entries = [];
    try {
        entries = scanFishDir(GLib.build_filenamev([ASSET_DIR, FISH_DIR]));
    } catch (err) {
        logError(err, 'koipond scan fish/');
    }
    const counts = parseCounts(FISH_CUSTOM_COUNTS);
    const roster = [];
    for (const e of entries) {
        const raw = counts[e.id];
        const n = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_PER_FILE, Math.round(raw))) : DEFAULT_COUNT;
        if (n <= 0)
            continue;
        const def = getFishDef(e);
        if (!def)
            continue;
        for (let i = 0; i < n; i++)
            roster.push(def);
    }
    return roster.slice(0, MAX_CUSTOM_FISH);
}

// ───────────── Cá koi ─────────────
const SEG = 9;
const PROFILE = [0.50, 0.60, 0.62, 0.58, 0.50, 0.40, 0.30, 0.22, 0.15];
const FISH_BEND = 0.30;   // rad: mỗi đốt thân chỉ gập tối đa bấy nhiêu so với đốt trước
let FISH_TURN = 3.2;    // rad/giây: tốc độ quay đầu tối đa (để thân không vặn)
let FISH_ACT_MIN = 10;  // giây: thỉnh thoảng cá đổi hành vi
let FISH_ACT_MAX = 24;  // giây: khoảng cách dài nhất giữa hai lần đổi hành vi
const FISH_DEPTH = 56;       // độ sâu nước (x u): cá nằm trong khoảng 0 (sát đáy) .. FISH_DEPTH (sát mặt nước)
const FISH_THICK = 0.55;     // chiều cao thân cá = size * hệ số này (hai cá chỉ va nhau khi khoảng độ cao chồng nhau)
const FISH_DIVE_SPEED = 9;   // đơn vị độ cao/giây (x u): tốc độ trồi lên / lặn xuống
const FISH_Z_MIN = 4;        // giây: ngắn nhất giữa hai lần cá chọn tầng mới
const FISH_Z_MAX = 12;       // giây: dài nhất giữa hai lần cá chọn tầng mới
let FISH_HIT = 0.9;        // thân cá "cứng" bằng bấy nhiêu lần bán kính vẽ (nhỏ hơn = cho phép lướt sát hơn)
let FISH_AVOID = 3.5;      // cá nhìn trước bấy nhiêu lần chiều dài thân để né con cùng tầng (0 = không né, chỉ bị đẩy khi chạm)
let FISH_DEPTH_TINT = 0.3; // cá ở sâu thì tối / xanh hơn (0 = tắt)
const FISH_DEEP = [0.05, 0.28, 0.38];
const PALETTES = [
    [[0.98, 0.46, 0.12], [1.00, 0.95, 0.90]],
    [[0.95, 0.20, 0.15], [1.00, 0.90, 0.80]],
    [[1.00, 0.75, 0.20], [1.00, 0.97, 0.90]],
    [[0.97, 0.97, 0.95], [0.98, 0.45, 0.15]],
    [[0.15, 0.15, 0.18], [0.98, 0.50, 0.15]],
];

// Các hướng quanh chu vi vật nổi để đo lực sóng (lấy trung bình nhiều điểm thay vì 4 điểm cách xa nhau)
const RING_N = 12;
const RING_COS = Array.from({length: RING_N}, (_, k) => Math.cos(k * TAU / RING_N));
const RING_SIN = Array.from({length: RING_N}, (_, k) => Math.sin(k * TAU / RING_N));

// Điểm thân của hai con cá chồng nhau sâu nhất (chỉ xét trên mặt phẳng ao).
// Trả về {pen, nx, ny} (pen > 0 = đang chồng nhau; n hướng từ a sang b) hoặc null nếu ở quá xa.
function fishContact(a, b) {
    const reach = a.spacing * (a.nseg - 1) + a.size + b.spacing * (b.nseg - 1) + b.size;
    if (Math.hypot(a.x - b.x, a.y - b.y) > reach)
        return null;
    let best = null;
    for (let i = 0; i < a.nseg; i++) {
        const p = a.segs[i], ra = a.size * a.profile[i] * FISH_HIT;
        for (let j = 0; j < b.nseg; j++) {
            const q = b.segs[j];
            const dx = q.x - p.x, dy = q.y - p.y;
            const d = Math.hypot(dx, dy);
            const pen = ra + b.size * b.profile[j] * FISH_HIT - d;
            if (!best || pen > best.pen) {
                if (d > 1e-6)
                    best = {pen, nx: dx / d, ny: dy / d};
                else
                    best = {pen, nx: Math.cos(a.angle), ny: Math.sin(a.angle)};
            }
        }
    }
    return best;
}

class Fish {
    constructor(pond, index, def = null) {
        this.pond = pond;
        this.def = def;      // null = cá koi vẽ bằng code mặc định
        const u = pond.u;
        const sr = def ? def.size : [15, 24];
        const br = def ? def.speed : [38, 62];
        // dùng lại các hàm rand cũ theo đúng thứ tự => cá mặc định không đổi bố cục so với trước
        this.size = rand(sr[0], sr[1]) * u;
        this.x = rand(0.1, 0.9) * pond.w;
        this.y = rand(0.1, 0.9) * pond.h;
        this.angle = rand(0, TAU);
        this.base = rand(br[0], br[1]) * u;
        this.speed = this.base;
        this.turn = 0;
        this.phase = rand(0, TAU);
        this.spacingK = def ? def.spacing : 0.55;
        this.spacing = this.size * this.spacingK;
        this.profile = def ? def.profile : PROFILE;
        this.nseg = def ? def.nseg : SEG;
        this.bend = def ? def.bend : FISH_BEND;
        this.waveAmp = def ? def.waveAmp : 0.10;
        this.waveStep = def ? def.waveStep : 0.8;
        this.waveSpeed = def ? def.waveSpeed : 1;
        // hình dạng khi vẽ bằng code (JSON có thể đổi các thông số này)
        this.tailLen = def?.tailLen ?? 1.5;
        this.tailSpread = def?.tailSpread ?? 0.5;
        this.tailAlpha = def?.tailAlpha ?? 0.6;
        this.finSize = def?.finSize ?? 0.55;
        this.finWidth = def?.finWidth ?? 0.2;
        this.finAlpha = def?.finAlpha ?? 0.55;
        this.eyeSize = def?.eye ?? 0.07;
        // chiều cao: thân cá chiếm khoảng độ cao [zBase, zBase + zH] tính từ đáy ao
        this.zH = this.size * FISH_THICK;
        this.zBase = rand(0, Math.max(0, FISH_DEPTH * u - this.zH));
        this.zTarget = this.zBase;
        this.zT = rand(FISH_Z_MIN, FISH_Z_MAX);
        this.actT = rand(FISH_ACT_MIN, FISH_ACT_MAX);   // đếm ngược tới hành vi kế tiếp
        this.action = null;
        this.turnTarget = 0;

        const pal = def?.colors ?? PALETTES[index % PALETTES.length];
        const acc = def?.accentChance ?? 0.4;
        this.colors = Array.from({length: this.nseg}, (_, k) => {
            const r = (k > 0 && _rng() < acc);
            if (def?.segColors) {
                const c = pal[Math.max(0, Math.min(pal.length - 1, Math.round(def.segColors[k] ?? 0)))];
                return c ?? pal[0];
            }
            return r ? (pal[1] ?? pal[0]) : pal[0];
        });
        this.segs = Array.from({length: this.nseg}, (_, k) => ({
            x: this.x - Math.cos(this.angle) * k * this.spacing,
            y: this.y - Math.sin(this.angle) * k * this.spacing,
        }));
    }

    update(dt) {
        const p = this.pond;
        const u = p.u;
        const a0 = this.angle;

        // thỉnh thoảng đổi hành vi (ngoi mặt nước / quay đầu / tăng tốc / đổi hướng)
        this._behave(dt);
        this._updateDepth(dt);

        // đi lang thang
        this.turn = clamp(this.turn + rand(-1, 1) * 3 * dt, -0.9, 0.9);
        this.angle += this.turn * dt;

        // hành vi: quay sang hướng mới
        if (this.action && (this.action.kind === 'turn' || this.action.kind === 'rand'))
            this.angle += clamp(angDiff(this.angle, this.turnTarget), -1, 1) * dt * 5;

        // tránh mép
        const m = 110 * u;
        let wx = 0, wy = 0;
        if (this.x < m) wx = 1; else if (this.x > p.w - m) wx = -1;
        if (this.y < m) wy = 1; else if (this.y > p.h - m) wy = -1;
        if (wx || wy)
            this.angle += clamp(angDiff(this.angle, Math.atan2(wy, wx)), -1, 1) * dt * 2.4;

        // giật mình khi có sóng
        let boost = 1;
        for (const r of p.ripples) {
            if (r.src === this || r.age > 1.4)
                continue;
            const dx = this.x - r.x, dy = this.y - r.y;
            const d = Math.hypot(dx, dy);
            const reach = 260 * u * r.amp;
            if (d < reach) {
                const k = (1 - d / reach) * (1 - r.age / 1.4);
                const away = Math.atan2(dy, dx);
                this.angle += clamp(angDiff(this.angle, away), -1, 1) * dt * 7 * k;
                boost = Math.max(boost, 1 + k * 4);
            }
        }

        const avoidSlow = this._avoidFish(dt);

        let target = this.base * boost;
        if (this.action) {
            if (this.action.kind === 'surface')
                target = this.base * 0.25;      // ngoi lên: khựng lại
            else if (this.action.kind === 'burst')
                target = Math.max(target, this.base * 2.2);
            else if (this.action.kind === 'turn')
                target = Math.max(target, this.base * 1.5);
            else if (this.action.kind === 'rand')
                target = Math.max(target, this.base * 1.3);
        }
        target *= avoidSlow;      // có cá cùng tầng chắn phía trước thì chậm lại
        this.speed += (target - this.speed) * Math.min(1, dt * 3);

        // giới hạn tốc độ quay đầu (trước khi bơi tiếp)
        this.angle = a0 + clamp(angDiff(a0, this.angle), -FISH_TURN * dt, FISH_TURN * dt);

        this.phase += dt * (3 + (this.speed / this.base) * 3) * this.waveSpeed;
        this.x = clamp(this.x + Math.cos(this.angle) * this.speed * dt, -30 * u, p.w + 30 * u);
        this.y = clamp(this.y + Math.sin(this.angle) * this.speed * dt, -30 * u, p.h + 30 * u);

        // chạm giới hạn ngoài thì quay đầu về giữa ao, không để cá bơi mất hẳn
        const lim = 30 * u;
        if (this.x <= -lim || this.x >= p.w + lim || this.y <= -lim || this.y >= p.h + lim) {
            const back = Math.atan2(p.h / 2 - this.y, p.w / 2 - this.x);
            this.angle += clamp(angDiff(this.angle, back), -1, 1) * 0.5;
        }

        // thân cá: chuỗi đốt bám theo đầu, mỗi khớp chỉ gập tối đa FISH_BEND
        // => thân uốn mượt, không gập khúc hay xoắn vào chính nó
        const s = this.segs;
        s[0].x = this.x;
        s[0].y = this.y;
        let pdir = Math.atan2(s[1].y - s[0].y, s[1].x - s[0].x);
        for (let i = 1; i < this.nseg; i++) {
            const a = s[i - 1], b = s[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            pdir += clamp(angDiff(pdir, Math.atan2(dy, dx)), -this.bend, this.bend);
            b.x = a.x + Math.cos(pdir) * this.spacing;
            b.y = a.y + Math.sin(pdir) * this.spacing;
        }
    }

    // Hai con có khoảng độ cao chồng nhau không? (base = độ cao đáy giả định của chính con này)
    zOverlaps(o, base = this.zBase) {
        return base < o.zBase + o.zH && o.zBase < base + this.zH;
    }

    // Tịnh tiến cả con cá (đầu + mọi đốt thân)
    shift(dx, dy) {
        this.x += dx;
        this.y += dy;
        for (const q of this.segs) {
            q.x += dx;
            q.y += dy;
        }
    }

    // Bị húc: hơi quay đầu ra khỏi con kia và chậm lại
    bump(nx, ny) {
        this.angle += clamp(angDiff(this.angle, Math.atan2(ny, nx)), -1, 1) * 0.08;
        this.speed *= 0.96;
    }

    // Thỉnh thoảng chọn tầng nước mới; ngoi lên thì trồi sát mặt. Không được lặn/trồi vào
    // khoảng độ cao của con khác khi thân hai con đang chồng nhau (nếu không sẽ xuyên qua nhau).
    _updateDepth(dt) {
        const u = this.pond.u;
        const top = Math.max(0, FISH_DEPTH * u - this.zH);
        this.zT -= dt;
        if (this.zT <= 0) {
            this.zT = rand(FISH_Z_MIN, FISH_Z_MAX);
            this.zTarget = rand(0, top);
        }
        if (this.action && this.action.kind === 'surface') {
            this.zTarget = top;
            this.zT = Math.max(this.zT, 2);
        }
        const step = FISH_DIVE_SPEED * u * dt;
        const nz = clamp(this.zBase + clamp(this.zTarget - this.zBase, -step, step), 0, top);
        if (nz !== this.zBase) {
            for (const o of this.pond.fish) {
                if (o === this || !this.zOverlaps(o, nz) || this.zOverlaps(o))
                    continue;
                const c = fishContact(this, o);
                if (c && c.pen > -this.size * 0.3)
                    return;     // sẽ chui vào người con kia: giữ nguyên tầng, thử lại sau
            }
        }
        this.zBase = nz;
    }

    // Nhìn trước: có thân cá cùng tầng ở phía trước thì lái sang bên (đi bên phải nhau như xe cộ)
    // và chậm lại. Trả về hệ số tốc độ 0..1.
    _avoidFish(dt) {
        if (FISH_AVOID <= 0)
            return 1;
        const look = this.size * FISH_AVOID;
        let steer = 0, slow = 1;
        for (const o of this.pond.fish) {
            if (o === this || !this.zOverlaps(o))
                continue;
            for (const q of o.segs) {
                const dx = q.x - this.x, dy = q.y - this.y;
                const d = Math.hypot(dx, dy);
                const reach = look + o.size * 0.6;
                if (d > reach || d < 1e-6)
                    continue;
                const rel = angDiff(this.angle, Math.atan2(dy, dx));
                if (Math.abs(rel) > 1.2)
                    continue;      // ở bên sườn xa / sau lưng: không cản đường
                const k = 1 - d / reach;
                steer -= (rel >= 0 ? 1 : -1) * k;
                slow = Math.min(slow, 1 - 0.5 * k);
            }
        }
        if (steer)
            this.angle += clamp(steer, -1, 1) * dt * 4;
        return slow;
    }

    // Thỉnh thoảng đổi hành vi; mỗi hành vi toé một gợn nước tại chỗ cá.
    // Gợn mạnh yếu theo tốc độ lúc cá làm động tác.
    _behave(dt) {
        const p = this.pond;
        if (this.action) {
            const a = this.action;
            a.t -= dt;
            if (!a.emitted && a.duration - a.t >= a.emitAt) {
                a.emitted = true;
                const sp = this.speed / this.base;
                const amp = a.kind === 'surface'
                    ? 0.24
                    : clamp(0.12 + 0.18 * (sp - 1), 0.12, 0.5);
                p.drop(this.x, this.y, amp, this);
            }
            if (a.t <= 0)
                this.action = null;
            return;
        }

        this.actT -= dt;
        if (this.actT > 0)
            return;
        this.actT = rand(FISH_ACT_MIN, FISH_ACT_MAX);

        const r = _rng();
        if (r < 0.28) {
            // ngoi lên mặt nước
            this.action = {kind: 'surface', t: 1.2, duration: 1.2, emitAt: 0.05, emitted: false};
        } else if (r < 0.53) {
            // quay đầu
            this.turnTarget = this.angle + Math.PI + rand(-0.5, 0.5);
            this.action = {kind: 'turn', t: 1.4, duration: 1.4, emitAt: 0.15, emitted: false};
        } else if (r < 0.78) {
            // tăng tốc
            this.action = {kind: 'burst', t: 1.6, duration: 1.6, emitAt: 0.4, emitted: false};
        } else {
            // đổi hướng ngẫu nhiên
            this.turnTarget = rand(0, TAU);
            this.action = {kind: 'rand', t: 1.2, duration: 1.2, emitAt: 0.15, emitted: false};
        }
    }

    // Uốn ảnh PNG theo xương sống: ảnh (đầu quay sang phải) được cắt thành các lát dọc thân; mỗi lát được
    // đặt vào đúng điểm trên đường "mũi đầu -> các đốt -> đuôi kéo dài" và xoay theo hướng của đường tại đó.
    _drawSprite(cr, shadow, pts, dk) {
        const d = this.def, img = d.img;
        const iw = img.getWidth(), ih = img.getHeight();
        const n = this.nseg - 1, size = this.size;

        // đường dẫn: mũi đầu, các đốt, rồi phần đuôi kéo dài có ngoe nguẩy
        const path = [];
        let hx = pts[0][0] - pts[1][0], hy = pts[0][1] - pts[1][1];
        const hl = Math.hypot(hx, hy) || 1;
        hx /= hl; hy /= hl;
        path.push([pts[0][0] + hx * d.headOff * size, pts[0][1] + hy * d.headOff * size]);
        for (const q of pts)
            path.push(q);
        const [tx, ty] = pts[n];
        let dx = tx - pts[n - 1][0], dy = ty - pts[n - 1][1];
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        const nx = -dy, ny = dx;
        const nominal = Math.max(d.length * size, d.headOff * size + this.spacing * n + 0.2 * size);
        const tailLen = Math.max(0.2 * size, nominal - d.headOff * size - this.spacing * n);
        const TS = 4;
        for (let k = 1; k <= TS; k++) {
            const f = k / TS;
            const sw = Math.sin(this.phase - n * this.waveStep + 1 - f * 1.2) * d.tailSwing * f * f * tailLen;
            path.push([tx + dx * tailLen * f + nx * sw, ty + dy * tailLen * f + ny * sw]);
        }
        const cum = [0];
        for (let i = 1; i < path.length; i++)
            cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));

        // điểm + góc tại độ dài cung a (ngoài hai đầu thì kéo dài đoạn đầu / đoạn cuối)
        let seg = 0;
        const at = a => {
            while (seg > 0 && a < cum[seg])
                seg--;
            while (seg < path.length - 2 && a > cum[seg + 1])
                seg++;
            const p0 = path[seg], p1 = path[seg + 1];
            const len = (cum[seg + 1] - cum[seg]) || 1;
            const t = (a - cum[seg]) / len;
            return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t,
                Math.atan2(p1[1] - p0[1], p1[0] - p0[0])];
        };

        const sc = nominal / iw;                        // 1 pixel ảnh = sc pixel ao
        const ns = Math.max(3, Math.min(d.strips, Math.floor(iw / 2)));
        const ov = 0.8 / sc;                            // lát chồng nhau ~0.8 pixel ao để khỏi hở khe khi thân cong
        const half = ih * sc / 2 + 2;

        // vùng chứa cá: nhóm vẽ tạm chỉ cần cỡ này
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of path) {
            x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]);
            x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
        }
        x0 = Math.floor(x0 - half - 2); y0 = Math.floor(y0 - half - 2);
        x1 = Math.ceil(x1 + half + 2); y1 = Math.ceil(y1 + half + 2);

        cr.save();
        cr.rectangle(x0, y0, x1 - x0, y1 - y0);
        cr.clip();
        cr.pushGroup();
        for (let k = 0; k < ns; k++) {
            const sx0 = k * iw / ns, sx1 = (k + 1) * iw / ns, xm = (sx0 + sx1) / 2;
            const [px, py, ang] = at(xm * sc);
            cr.save();
            cr.translate(px, py);
            cr.rotate(ang);
            cr.scale(sc, sc);
            cr.translate(-xm, -ih / 2);
            cr.setOperator(Cairo.Operator.SOURCE);     // lát sau thay hẳn lát trước ở chỗ chồng nhau (không bị đậm đôi ở phần bán trong suốt)
            cr.rectangle(sx0 - (k > 0 ? ov : 0), 0, sx1 - sx0 + (k > 0 ? ov : 0) + (k < ns - 1 ? ov : 0), ih);
            cr.clip();
            if (shadow) {
                cr.setSourceRGBA(0, 0.03, 0.06, 1);
                cr.maskSurface(img, 0, 0);
            } else {
                cr.setSourceSurface(img, 0, 0);
                cr.paint();
            }
            cr.restore();
        }
        if (!shadow && dk > 0) {
            // cá ở sâu thì tối / xanh hơn: phủ màu nước sâu lên đúng phần có cá
            cr.setOperator(Cairo.Operator.ATOP);
            cr.setSourceRGBA(FISH_DEEP[0], FISH_DEEP[1], FISH_DEEP[2], dk);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
        }
        cr.popGroupToSource();
        cr.paintWithAlpha(shadow ? 0.14 : 0.97);
        cr.restore();
    }

    draw(cr, shadow) {
        const u = this.pond.u;
        // 0 = sát đáy, 1 = sát mặt nước: cá càng cao thì bóng trên đáy càng lệch xa, thân càng sáng
        const zk = clamp(this.zBase / Math.max(1e-6, FISH_DEPTH * u - this.zH), 0, 1);
        const sk = 0.4 + 0.6 * zk;
        const ox = shadow ? 7 * u * sk : 0;
        const oy = shadow ? 10 * u * sk : 0;
        const dk = FISH_DEPTH_TINT * (1 - zk);
        const n = this.nseg - 1;
        const segs = this.segs;

        const pts = segs.map((q, i) => {
            // rung lăn tăn theo pháp tuyến của xương sống tại chỗ đó
            // (dùng pháp tuyến cục bộ nên thân cong vẫn uốn mượt, không bị vặn)
            const a = segs[Math.max(0, i - 1)];
            const b = segs[Math.min(n, i + 1)];
            let ax = -(b.y - a.y), ay = b.x - a.x;
            const al = Math.hypot(ax, ay) || 1;
            ax /= al; ay /= al;
            const w = Math.sin(this.phase - i * this.waveStep) * this.size * this.waveAmp * (i / n);
            return [q.x + ax * w + ox, q.y + ay * w + oy];
        });

        const col = (c, a) => {
            if (shadow) {
                cr.setSourceRGBA(0, 0.03, 0.06, 0.14);
            } else if (dk > 0) {
                const m = mix3(c, FISH_DEEP, dk);
                cr.setSourceRGBA(m[0], m[1], m[2], a);
            } else {
                cr.setSourceRGBA(c[0], c[1], c[2], a);
            }
        };

        // cá dùng ảnh PNG: uốn ảnh theo xương sống rồi thôi
        if (this.def?.kind === 'sprite') {
            this._drawSprite(cr, shadow, pts, dk);
            return;
        }

        // đuôi
        const [tx, ty] = pts[n];
        const [bx, by] = pts[n - 1];
        let dx = tx - bx, dy = ty - by;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        const nx = -dy, ny = dx;
        const sw = Math.sin(this.phase - n * this.waveStep + 1) * this.tailSpread;
        const L = this.size * this.tailLen;
        cr.newPath();
        cr.moveTo(tx, ty);
        cr.curveTo(
            tx + dx * L * 0.5 + nx * L * (this.tailSpread + sw), ty + dy * L * 0.5 + ny * L * (this.tailSpread + sw),
            tx + dx * L + nx * L * (0.35 + sw), ty + dy * L + ny * L * (0.35 + sw),
            tx + dx * L * 0.8 + nx * sw * L * 0.2, ty + dy * L * 0.8 + ny * sw * L * 0.2);
        cr.curveTo(
            tx + dx * L + nx * L * (-0.35 + sw), ty + dy * L + ny * L * (-0.35 + sw),
            tx + dx * L * 0.5 - nx * L * (this.tailSpread - sw), ty + dy * L * 0.5 - ny * L * (this.tailSpread - sw),
            tx, ty);
        cr.closePath();
        col(this.colors[n], this.tailAlpha);
        cr.fill();

        // vây ngực
        let hx = pts[1][0] - pts[3][0], hy = pts[1][1] - pts[3][1];
        const hl = Math.hypot(hx, hy) || 1;
        hx /= hl; hy /= hl;
        for (const side of [-1, 1]) {
            cr.newPath();
            cr.save();
            cr.translate(pts[2][0] - hy * side * this.size * this.finSize,
                pts[2][1] + hx * side * this.size * this.finSize);
            cr.rotate(Math.atan2(hy, hx) + side * (0.6 + Math.sin(this.phase) * 0.15));
            cr.scale(this.size * this.finSize, this.size * this.finWidth);
            cr.arc(0, 0, 1, 0, TAU);
            cr.restore();
            col(this.colors[2], this.finAlpha);
            cr.fill();
        }

        // thân
        for (let i = n; i >= 0; i--) {
            cr.newPath();
            cr.arc(pts[i][0], pts[i][1], this.size * this.profile[i], 0, TAU);
            col(this.colors[i], 0.97);
            cr.fill();
        }

        // mắt
        if (!shadow && this.eyeSize > 0) {
            let ex = pts[0][0] - pts[1][0], ey = pts[0][1] - pts[1][1];
            const el = Math.hypot(ex, ey) || 1;
            ex /= el; ey /= el;
            for (const side of [-1, 1]) {
                cr.newPath();
                cr.arc(pts[0][0] + ex * this.size * 0.2 - ey * side * this.size * 0.28,
                    pts[0][1] + ey * this.size * 0.2 + ex * side * this.size * 0.28,
                    Math.max(0.8, this.size * this.eyeSize), 0, TAU);
                cr.setSourceRGBA(0.05, 0.05, 0.05, 0.9);
                cr.fill();
            }
        }
    }
}

// ───────────── Lá sen ─────────────
class Pad {
    constructor(pond) {
        const u = pond.u;
        this.pond = pond;
        this.x = rand(0.08, 0.92) * pond.w;
        this.y = rand(0.08, 0.92) * pond.h;
        this.r = rand(24, 42) * u;
        this.a = rand(0, TAU);
        this.ph = rand(0, TAU);
        this.pulse = 0;
        this.flower = _rng() < 0.35;
        this.vx = 0;
        this.vy = 0;

        // nhiều kiểu lá bèo: lá tròn đủ, khuyết một chút, và khuyết to như lá sen
        const roll = _rng();
        this.notch = roll < 0.28 ? 0 : roll < 0.66 ? rand(0.10, 0.20) : rand(0.27, 0.36);

        // vật nặng: lá rụng đụng vào thì lá sen gần như không nhúc nhích
        this.mass = this.r * this.r * 4;
        this.invMass = 1 / this.mass;
        this.invI = 0;      // lá sen không xoay tự do khi bị húc
        this.av = 0;
    }

    update(dt) {
        const p = this.pond;
        const u = p.u;
        this.a += Math.sin(p.t * 0.3 + this.ph) * dt * 0.05;

        // sóng đập vào mép lá: lá bị cuốn theo (vận tốc mục tiêu, bão hoà) và nhún nhẹ
        const [wx, wy, wm] = p.waveForce(this, this.r);
        const [dx, dy] = p.waveDrive(this, wx, wy, WAVE_PUSH_GAIN_PAD * u, WAVE_PUSH_PAD * u, dt);

        // đang bị chuột kéo: lò xo về phía con trỏ (hơi đàn hồi, thả ra thì trôi tiếp)
        const held = p.grab && p.grab.obj === this;
        if (held) {
            this.vx += ((p.grab.x - this.x) * 150 - this.vx * 18) * dt;
            this.vy += ((p.grab.y - this.y) * 150 - this.vy * 18) * dt;
        } else {
            // trôi theo dòng nước + sóng (chậm hơn lá nhỏ vì nặng hơn)
            const [fx, fy] = p.flow(this.x, this.y);
            const k = Math.min(1, dt * 1.2);
            this.vx += (fx * 0.6 + dx - this.vx) * k;
            this.vy += (fy * 0.6 + dy - this.vy) * k;
        }
        this.pulse = Math.max(this.pulse, Math.min(1, wm * 6));
        this.pulse *= Math.exp(-dt * 2.5);

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // giữ lá trong màn hình, cho phép lấn ra ngoài một chút
        p.confine(this, this.r * 0.35, dt);

        // di chuyển trên mặt nước (kéo, quán tính, dòng nước...) đều rẽ nước
        p.wakeTrail(this, this.r);
    }

    draw(cr, shadow) {
        // shadow === 'mask': chỉ tô đặc hình dạng lá (dùng để khoét mặt trời / mặt trăng ra khỏi chỗ lá che)
        const mask = shadow === 'mask';
        if (mask)
            shadow = false;
        const u = this.pond.u;
        const t = this.pond.t;
        const bob = Math.sin(t * 0.5 + this.ph) * 2 * u;
        const sc = 1 + this.pulse * 0.07;
        cr.save();
        cr.translate(this.x + (shadow ? 6 * u : 0), this.y + bob + (shadow ? 8 * u : 0));
        // đong đưa: hơi chao nghiêng và lắc qua lại theo nhịp nước
        cr.scale(sc * (1 + Math.sin(t * 0.9 + this.ph) * 0.04),
            sc * (1 + Math.cos(t * 0.7 + this.ph) * 0.04));
        cr.rotate(this.a + Math.sin(t * 0.8 + this.ph) * 0.1);

        cr.newPath();
        if (this.notch > 0.01) {
            cr.arc(0, 0, this.r, this.notch, TAU - this.notch);
            cr.lineTo(0, 0);
            cr.closePath();
        } else {
            cr.arc(0, 0, this.r, 0, TAU);
        }

        if (mask) {
            cr.setSourceRGBA(0, 0, 0, 1);
            cr.fill();
            cr.restore();
            return;
        }

        if (shadow) {
            cr.setSourceRGBA(0, 0.03, 0.06, 0.16);
            cr.fill();
        } else {
            cr.setSourceRGBA(0.16, 0.55, 0.28, 0.97);
            cr.fillPreserve();
            cr.setSourceRGBA(0.08, 0.33, 0.17, 0.9);
            cr.setLineWidth(lw(1.2 * u));
            cr.stroke();

            cr.setSourceRGBA(0.6, 0.9, 0.6, 0.25);
            cr.setLineWidth(lw(1 * u));
            for (let k = 0; k < 6; k++) {
                const a = 0.5 + k * ((TAU - 1.0) / 5);
                cr.newPath();
                cr.moveTo(0, 0);
                cr.lineTo(Math.cos(a) * this.r * 0.9, Math.sin(a) * this.r * 0.9);
                cr.stroke();
            }

            if (this.flower) {
                for (let k = 0; k < 8; k++) {
                    cr.save();
                    cr.rotate(k * TAU / 8);
                    cr.translate(this.r * 0.22, 0);
                    cr.scale(this.r * 0.22, this.r * 0.1);
                    cr.newPath();
                    cr.arc(0, 0, 1, 0, TAU);
                    cr.restore();
                    cr.setSourceRGBA(1, 0.7, 0.8, 0.95);
                    cr.fill();
                }
                cr.newPath();
                cr.arc(0, 0, Math.max(1, this.r * 0.09), 0, TAU);
                cr.setSourceRGBA(1, 0.85, 0.25, 1);
                cr.fill();
            }
        }
        cr.restore();
    }
}

// ───────────── Lá rụng nhỏ trôi trên mặt nước ─────────────
const LEAF_COLORS = [
    [0.55, 0.75, 0.25],
    [0.85, 0.70, 0.20],
    [0.80, 0.45, 0.15],
    [0.45, 0.62, 0.22],
    [0.65, 0.35, 0.15],
];

class Leaf {
    constructor(pond) {
        const u = pond.u;
        this.pond = pond;
        this.x = rand(0, pond.w);
        this.y = rand(0, pond.h);
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;                    // tốc độ rơi thẳng đứng
        this.len = rand(7, 12) * u;     // nửa chiều dài lá
        this.a = rand(0, TAU);
        this.av = 0;                    // vận tốc xoay, do va chạm / sóng truyền cho
        this.spin = rand(-0.25, 0.25);
        this.ph = rand(0, TAU);
        this.color = LEAF_COLORS[Math.floor(_rng() * LEAF_COLORS.length)];

        // Va chạm: lá là một "viên thuốc" — xương sống là đoạn thẳng dài bằng lá,
        // bọc bán kính nửa bề ngang. Nhờ vậy lá quay thế nào cũng không đè lên nhau.
        this.rad = this.len * 0.5;
        this.mass = this.len * this.len;
        this.invMass = 1 / this.mass;
        this.invI = 1 / (this.mass * this.len * this.len * 0.22);

        // 'water' = trôi trên mặt nước, 'pad' = đậu trên lá sen,
        // 'fall' = đang rơi từ trên xuống, 'sink' = đang chìm dần dưới mặt nước
        this.state = 'water';
        this.home = null;       // lá bèo đang đậu lên
        this.h = 0;             // cao hơn mặt nước (px ao)
        this.dead = false;      // đã chìm hẳn, chờ xoá khỏi ao
        this.wetLimit = rand(LEAF_FLOAT_LIFE[0], LEAF_FLOAT_LIFE[1]);
        this.wetT = rand(0, this.wetLimit * 0.85);          // đã trôi trên nước bao lâu (lệch pha nhau)
        this.sinkWait = -1;     // > 0: sắp chìm
        this.sinkT = 0;         // thời gian còn lại của màn chìm
        this.fade = 1;          // hiện dần khi mới bắt đầu rơi xuống
        this.soak = 0;          // 0 = khô, 1 = ngấm đủ nước thì chìm
        this.bedTilt = rand(0.55, 0.95);   // độ nghiêng cố định khi nằm dưới đáy
        this.bedFade = 1;       // mờ dần khi bị dọn khỏi đáy
        this.retire = false;    // true: lá dưới đáy đang mờ dần để biến mất
        this._padX = 0;
        this._padY = 0;
        this._padA = 0;
    }

    // Hai đầu xương sống của lá (đoạn dùng để tính va chạm)
    capsule() {
        const c = Math.cos(this.a) * this.len * 0.5;
        const s = Math.sin(this.a) * this.len * 0.5;
        return [this.x - c, this.y - s, this.x + c, this.y + s];
    }

    // Đặt lá nằm sẵn trên một lá sen (dùng lúc tạo cảnh)
    placeOnPad(pad) {
        const u = this.pond.u;
        const lo = pad.notch > 0.01 ? pad.notch + 0.25 : 0;   // tránh chỗ khuyết của lá sen
        const ang = pad.a + rand(lo, TAU - lo);
        const rho = pad.r * rand(0.2, 0.45);
        this.x = pad.x + Math.cos(ang) * rho;
        this.y = pad.y + Math.sin(ang) * rho;
        this.a = rand(0, TAU);
        this.vx = pad.vx;
        this.vy = pad.vy;
        this.av = 0;
        this.state = 'pad';
        this.home = pad;
        this._padX = pad.x;
        this._padY = pad.y;
        this._padA = pad.a;
        this.h = LEAF_HEIGHT * u;
        this.wetT = 0;
    }

    // Bắt đầu rơi từ trên cao xuống mặt nước (lá mới rụng)
    startFall() {
        const p = this.pond;
        const u = p.u;
        this.state = 'fall';
        this.home = null;
        this.dead = false;

        // thường rơi xuống quanh một lá sen còn chỗ, thỉnh thoảng rơi chỗ khác
        const free = p.pads.filter(pd => p._leafCount(pd) < LEAF_PER_PAD);
        const abovePad = free.length && _rng() < 0.6
            ? free[Math.floor(_rng() * free.length)]
            : null;
        if (abovePad) {
            const ang = rand(0, TAU);
            const rr = abovePad.r * rand(0, 0.35);
            this.x = abovePad.x + Math.cos(ang) * rr;
            this.y = abovePad.y + Math.sin(ang) * rr;
        } else {
            this.x = rand(0.08, 0.92) * p.w;
            this.y = rand(0.08, 0.92) * p.h;
        }

        this.h = rand(0.85, 1.15) * LEAF_FALL_HEIGHT * u;
        this.vz = rand(0, 14) * u;
        this.vx = rand(-5, 5) * u;
        this.vy = rand(-5, 5) * u;
        this.a = rand(0, TAU);
        this.av = rand(-2, 2);
        this.wetT = 0;
        this.sinkWait = -1;
        this.fade = 0;
    }

    // Bị sóng đánh văng khỏi mặt lá sen: hất nhẹ lên rồi rơi xuống nước
    _knockOff(vx, vy, splash) {
        this.state = 'fall';
        this.home = null;
        this.vz = -rand(0, 10) * this.pond.u;
        this.vx = vx;
        this.vy = vy;
        this.av = rand(-2.5, 2.5);
        this.wetT = 0;
        this.sinkWait = -1;
        this.fade = 1;
        if (splash)
            this.pond.drop(this.x, this.y, LEAF_SPLASH);
    }

    // Chạm mặt nước: đậu lên lá sen nếu ngay bên dưới có lá sen, không thì trôi trên nước.
    // impact = tốc độ rơi lúc chạm (px/giây) — rơi càng cao thì gợn càng mạnh.
    _land(impact = 0) {
        const p = this.pond;
        const u = p.u;
        this.h = 0;
        this.vz = 0;
        this.vx *= 0.35;
        this.vy *= 0.35;

        let pad = null, best = Infinity;
        for (const pd of p.pads) {
            const d = Math.hypot(this.x - pd.x, this.y - pd.y);
            if (d < pd.r * 0.85 && d < best && p._leafCount(pd) < LEAF_PER_PAD) {
                pad = pd;
                best = d;
            }
        }

        // đáp xuống mặt lá sen (rơi trúng chỗ khuyết thì vẫn rơi xuống nước)
        if (pad && !this._overNotch(pad)) {
            this.state = 'pad';
            this.home = pad;
            this.h = LEAF_HEIGHT * u;
            this.vx = pad.vx;
            this.vy = pad.vy;
            this.av = 0;
            this._padX = pad.x;
            this._padY = pad.y;
            this._padA = pad.a;
            this.wetT = 0;
            return;
        }

        // rơi xuống nước: toé gợn, và có tỉ lệ lá bị chìm
        this.state = 'water';
        this.home = null;
        this._clearPads();      // rơi sát mép lá sen thì nằm hẳn ra ngoài mép
        this.wetT = 0;
        this.sinkWait = _rng() < LEAF_SINK_CHANCE ? rand(0.5, 2.2) : -1;
        p.drop(this.x, this.y, clamp(0.05 + impact / (170 * u) * 0.12, 0.05, 0.17));
    }

    // Đẩy lá ra khỏi mép lá sen (dùng khi lá vừa rơi xuống sát mép)
    _clearPads() {
        const p = this.pond;
        for (let k = 0; k < 6; k++) {
            let moved = false;
            const [ax, ay, bx, by] = this.capsule();
            for (const pad of p.pads) {
                const [px, py] = closestPointOnSeg(pad.x, pad.y, ax, ay, bx, by);
                const nx = px - pad.x, ny = py - pad.y;
                const d = Math.hypot(nx, ny);
                const minD = pad.r * 0.94 + this.rad;
                if (d < minD && d > 1e-6) {
                    const push = minD - d;
                    this.x += nx / d * push;
                    this.y += ny / d * push;
                    moved = true;
                }
            }
            if (!moved)
                break;
        }
    }

    // Lá có đang rơi đúng vào khoảng khuyết của lá sen không?
    _overNotch(pad) {
        if (pad.notch <= 0.01)
            return false;
        const loc = ((Math.atan2(this.y - pad.y, this.x - pad.x) - pad.a) % TAU + TAU) % TAU;
        return Math.min(loc, TAU - loc) < pad.notch + 0.06;
    }

    _startSink() {
        if (this.pond.grab && this.pond.grab.obj === this)
            this.pond.endGrab();
        this.state = 'sink';
        this.home = null;
        this.sinkT = LEAF_SINK_TIME;
        this.sinkWait = -1;
        this.vx = 0;
        this.vy = 0;
        this.av = 0;
    }

    _updateOnPad(dt) {
        const p = this.pond;
        const u = p.u;
        const pad = this.home;
        const oldX = this.x, oldY = this.y;

        // đi theo lá sen: tịnh tiến + xoay
        const da = pad.a - this._padA;
        const ox = this.x - this._padX, oy = this.y - this._padY;
        const ca = Math.cos(da), sa = Math.sin(da);
        this.x = pad.x + ox * ca - oy * sa;
        this.y = pad.y + ox * sa + oy * ca;
        this.a += da;

        // lá không nằm trên chỗ khuyết của lá sen: bị đẩy nhẹ ra khỏi khoảng trống đó
        let dx = this.x - pad.x, dy = this.y - pad.y;
        let d = Math.hypot(dx, dy);
        const half = pad.notch > 0.01 ? pad.notch + 0.10 : 0;
        if (half > 0 && d > 1e-3) {
            const loc = ((Math.atan2(dy, dx) - pad.a) % TAU + TAU) % TAU;
            const adist = Math.min(loc, TAU - loc);
            if (adist < half) {
                const tgt = loc < Math.PI ? half : TAU - half;
                const na = loc + angDiff(loc, tgt) * Math.min(1, dt * 4);
                this.x = pad.x + Math.cos(na + pad.a) * d;
                this.y = pad.y + Math.sin(na + pad.a) * d;
                dx = this.x - pad.x;
                dy = this.y - pad.y;
            }
        }

        // nhớ lại mốc của lá sen cho khung hình sau
        this._padX = pad.x;
        this._padY = pad.y;
        this._padA = pad.a;

        // nằm trên mặt lá sen (cao hơn mặt nước một chút)
        this.h = LEAF_HEIGHT * u;

        // vận tốc thật của lá (dùng khi va chạm, khi bị sóng hất xuống)
        if (dt > 1e-4) {
            this.vx = (this.x - oldX) / dt;
            this.vy = (this.y - oldY) / dt;
        }

        // bị đẩy quá mép lá sen thì trượt xuống nước
        if (d > pad.r * 0.99) {
            const nl = d > 1e-4 ? 1 / d : 0;
            this._knockOff(this.vx + dx * nl * 18 * u, this.vy + dy * nl * 18 * u, true);
            return;
        }

        // sóng mạnh đánh văng lá khỏi mặt lá sen (nằm gần mép thì càng dễ văng)
        const [wm, wdx, wdy] = p.waveRing(pad.x, pad.y, pad.r * 0.94 + WAVE_CELL * 1.5);
        const rel = clamp(d / Math.max(1, pad.r), 0, 1);
        if (wm > LEAF_WASH * (1.35 - 0.7 * rel)) {
            // sóng ập vào phía nào thì lá bị đẩy sang phía đối diện
            let nx = wdx, ny = wdy;
            const gl = Math.hypot(nx, ny);
            if (gl < 1e-4) {
                const dl = Math.hypot(dx, dy) || 1;
                nx = dx / dl;
                ny = dy / dl;
            } else {
                nx /= gl;
                ny /= gl;
            }
            const kick = (70 + 700 * Math.min(wm, 0.2)) * u;
            this._knockOff(pad.vx + nx * kick, pad.vy + ny * kick, true);
        }
    }

    update(dt) {
        if (this.state === 'fall') {
            this._updateFall(dt);
        } else if (this.state === 'pad') {
            this._updateOnPad(dt);
        } else if (this.state === 'sink') {
            this._updateSink(dt);
        } else if (this.state === 'bed') {
            this._updateBed(dt);
        } else {
            this._updateWater(dt);
        }
    }

    // Đang rơi từ trên cao xuống
    _updateFall(dt) {
        const p = this.pond;
        const u = p.u;
        this.vz += LEAF_FALL_GRAVITY * u * dt;
        this.h -= this.vz * dt;

        // gió đẩy nhẹ + chao qua lại
        this.x += (this.vx + Math.sin(p.t * 0.8 + this.ph) * 9 * u) * dt;
        this.y += (this.vy + Math.cos(p.t * 0.6 + this.ph) * 6 * u) * dt;
        this.a += this.av * dt;
        this.fade = Math.min(1, this.fade + dt / 0.35);
        p.confine(this, this.len, dt);

        if (this.h <= 0) {
            this.h = 0;
            this._land(this.vz);
        }
    }

    // Trôi trên mặt nước
    _updateWater(dt) {
        const p = this.pond;
        const u = p.u;
        const t = p.t;

        const [wx, wy, wm] = p.waveForce(this, this.len);
        const [dx, dy] = p.waveDrive(this, wx, wy, WAVE_PUSH_GAIN_LEAF * u, WAVE_PUSH_LEAF * u, dt);

        // đang bị chuột kéo: lò xo về phía con trỏ (lá nhẹ nên bám nhanh)
        const held = p.grab && p.grab.obj === this;
        if (held) {
            this.vx += ((p.grab.x - this.x) * 220 - this.vx * 20) * dt;
            this.vy += ((p.grab.y - this.y) * 220 - this.vy * 20) * dt;
        } else {
            // trôi theo dòng + sóng, thêm chút lắc ngang cho tự nhiên
            const [fx, fy] = p.flow(this.x, this.y);
            // lá chỉ trôi đúng bằng dòng nước (không nhanh hơn), nước hãm mạnh nên vận tốc bám sát dòng,
            // không trượt đi sau khi bị đẩy; lá ngấm nước càng nhiều càng nặng nề
            const tx = fx + Math.sin(t * 0.9 + this.ph) * 1.0 * u + dx;
            const ty = fy + Math.cos(t * 0.8 + this.ph) * 1.0 * u + dy;
            const k = Math.min(1, dt * LEAF_DRAG * (1 + 1.5 * this.soak));
            this.vx += (tx - this.vx) * k;
            this.vy += (ty - this.vy) * k;
        }

        // khuấy động làm lá ngấm nước: sóng quanh lá, cá trồi sát mặt bơi dưới lá, bị kéo lê
        let soakRate = wm > LEAF_SOAK_MIN ? LEAF_SOAK_WAVE * (wm - LEAF_SOAK_MIN) : 0;
        if (held)
            soakRate += LEAF_SOAK_HELD;
        const topZ = FISH_DEPTH * u;
        for (const f of p.fish) {
            if (topZ - (f.zBase + f.zH) > LEAF_FISH_TOP * u)
                continue;       // cá bơi sâu: không chạm được lá trên mặt
            if (Math.hypot(this.x - f.x, this.y - f.y) > f.spacing * (f.nseg - 1) + f.size * 1.5 + this.len)
                continue;
            for (let i = 0; i < f.nseg; i++) {
                const q = f.segs[i];
                const fdx = this.x - q.x, fdy = this.y - q.y;
                const d = Math.hypot(fdx, fdy);
                const reach = f.size * f.profile[i] * 1.2 + this.len * 0.6;
                if (d >= reach)
                    continue;
                const kk = 1 - d / reach;
                soakRate += LEAF_SOAK_FISH * kk;
                if (d > 1e-6) {
                    // cá quẫy nước đẩy lá ra một chút
                    this.vx += fdx / d * kk * f.speed * 6 * dt;
                    this.vy += fdy / d * kk * f.speed * 6 * dt;
                }
            }
        }
        this.soak = clamp(this.soak + (soakRate > 0 ? soakRate : -LEAF_DRY) * dt, 0, 1.2);

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // xoay: nước hãm xoay rất nhanh, va chạm truyền mô men xoay rồi tắt dần về nhịp chao nhẹ
        const lazy = this.spin + Math.sin(t * 1.2 + this.ph) * 0.35;
        this.av += (lazy - this.av) * Math.min(1, dt * 2.5);
        this.a += this.av * dt;

        p.confine(this, this.len, dt);

        // ngấm nước: có lá chìm ngay sau khi rơi xuống, có lá trôi một lúc mới chìm
        // (đang bị kéo thì chưa chìm)
        if (!held) {
            this.wetT += dt;
            if (this.sinkWait > 0) {
                this.sinkWait -= dt;
                if (this.sinkWait <= 0)
                    this._startSink();
            } else if (this.wetT > this.wetLimit || this.soak >= 1) {
                this._startSink();
            }
        }

        // đang trôi trên mặt nước (kéo, quán tính, dòng nước...) thì rẽ nước
        if (this.state === 'water')
            p.wakeTrail(this, this.rad + 2 * u);
    }

    // Đang chìm dần dưới mặt nước
    _updateSink(dt) {
        this.sinkT -= dt;
        if (this.sinkT <= 0) {
            // chạm đáy: nằm yên ở đó
            this.state = 'bed';
            this.vx = 0;
            this.vy = 0;
            this.av = 0;
        }
    }

    // Nằm dưới đáy: hoàn toàn đứng yên (không dòng nước, không sóng mặt, không va chạm với vật nổi).
    // Chỉ khi một con cá ở tầng sát đáy bơi ngang qua thì lá mới bị hất đi / xoay, rồi ma sát làm dừng lại.
    _updateBed(dt) {
        const p = this.pond;
        const u = p.u;

        if (this.retire) {
            this.bedFade -= dt / 2;
            if (this.bedFade <= 0) {
                this.dead = true;
                return;
            }
        }

        const zMax = FISH_BED_Z * u;
        for (const f of p.fish) {
            if (f.zBase > zMax)
                continue;       // cá bơi cao hơn đáy: không chạm được lá
            const zk = 1 - f.zBase / zMax;
            if (Math.hypot(this.x - f.x, this.y - f.y) > f.spacing * (f.nseg - 1) + f.size * 1.6 + this.len)
                continue;
            const fx = Math.cos(f.angle), fy = Math.sin(f.angle);
            for (let i = 0; i < f.nseg; i++) {
                const q = f.segs[i];
                let dx = this.x - q.x, dy = this.y - q.y;
                const d = Math.hypot(dx, dy);
                const reach = f.size * f.profile[i] * 1.5 + this.len * 0.6;
                if (d >= reach)
                    continue;
                if (d > 1e-6) {
                    dx /= d;
                    dy /= d;
                } else {
                    dx = -fy;
                    dy = fx;
                }
                const k = (1 - d / reach) * zk;
                const acc = LEAF_BED_KICK * f.speed * k;
                // bị đẩy ra khỏi thân cá và cuốn theo hướng cá bơi (dòng xoáy sau thân)
                this.vx += (dx * 0.7 + fx * 0.5) * acc * dt;
                this.vy += (dy * 0.7 + fy * 0.5) * acc * dt;
                // lá nằm lệch phía nào so với hướng cá bơi thì xoay theo phía đó
                this.av += (dx * fy - dy * fx) * acc * 0.02 * dt;
            }
        }

        const sp = Math.hypot(this.vx, this.vy);
        if (sp < 0.8 * u && Math.abs(this.av) < 0.05) {
            this.vx = 0;
            this.vy = 0;
            this.av = 0;
            return;
        }

        const damp = Math.exp(-dt * LEAF_BED_DAMP);
        this.vx *= damp;
        this.vy *= damp;
        this.av *= Math.exp(-dt * 3);
        this.x = clamp(this.x + this.vx * dt, 0, p.w);
        this.y = clamp(this.y + this.vy * dt, 0, p.h);
        this.a += this.av * dt;
    }

    draw(cr, shadow) {
        const mask = shadow === 'mask';   // chỉ tô đặc hình dạng lá để khoét mặt trời / mặt trăng
        if (mask)
            shadow = false;
        const p = this.pond;
        const u = p.u;
        const t = p.t;
        const L = this.len;
        const W = L * 0.42;

        // đang chìm / đã nằm dưới đáy: không có bóng, ngả màu nước, đậm dần về mức LEAF_BED_ALPHA
        if (this.state === 'sink' || this.state === 'bed') {
            if (shadow)
                return;
            const prog = this.state === 'bed' ? 1 : clamp(1 - this.sinkT / LEAF_SINK_TIME, 0, 1);
            const c = mix3(this.color, [0.07, 0.28, 0.28], 0.35 + (LEAF_BED_MIX - 0.35) * prog);
            const tilt = (0.6 + 0.4 * Math.abs(Math.cos(t * 0.7 + this.ph))) * (1 - prog) + this.bedTilt * prog;
            const alpha = (0.92 + (LEAF_BED_ALPHA - 0.92) * prog) * this.bedFade;
            cr.save();
            cr.translate(this.x, this.y);
            cr.rotate(this.a);
            cr.scale(1 - 0.18 * prog, tilt * (1 - 0.18 * prog));
            cr.newPath();
            cr.moveTo(-L, 0);
            cr.curveTo(-L * 0.4, -W * 1.6, L * 0.5, -W * 1.6, L, 0);
            cr.curveTo(L * 0.5, W * 1.6, -L * 0.4, W * 1.6, -L, 0);
            cr.closePath();
            cr.setSourceRGBA(c[0], c[1], c[2], alpha);
            cr.fill();
            cr.restore();
            return;
        }

        const falling = this.state === 'fall';
        const onPad = this.state === 'pad';
        let shx, shy, alpha, grow;

        if (falling) {
            // đang rơi: lá to hơn một chút, bóng trên mặt nước xa và nhạt
            const fz = clamp(this.h / Math.max(1e-6, LEAF_FALL_HEIGHT * u), 0, 1);
            shx = (3 + 13 * fz) * u;
            shy = (4 + 16 * fz) * u;
            alpha = (0.055 + 0.105 * (1 - fz)) * this.fade;
            grow = 1 + 0.16 * fz;
        } else {
            // trên mặt nước / trên lá sen: bóng sát lại khi lá nằm hẳn trên lá sen
            let over = 1;
            if (onPad) {
                const dd = Math.hypot(this.x - this.home.x, this.y - this.home.y);
                over = clamp((this.home.r - dd) / (this.rad * 1.2) + 0.5, 0, 1);
            }
            shx = (3 - 1.5 * over) * u;
            shy = (4 - 1.7 * over) * u;
            alpha = 0.16 + 0.06 * over;
            grow = 1;
        }

        const bob = onPad ? Math.sin(t * 0.5 + this.home.ph) * 2 * u : 0;

        // lá chao nghiêng: lúc bẹt lúc nghiêng
        const tilt = 0.6 + 0.4 * Math.abs(Math.cos(t * 0.7 + this.ph));

        cr.save();
        cr.translate(this.x + (shadow ? shx : 0), this.y + bob + (shadow ? shy : 0));
        if (!shadow)
            cr.scale(grow, grow);
        cr.rotate(this.a);
        cr.scale(1, tilt);
        cr.newPath();
        cr.moveTo(-L, 0);
        cr.curveTo(-L * 0.4, -W * 1.6, L * 0.5, -W * 1.6, L, 0);
        cr.curveTo(L * 0.5, W * 1.6, -L * 0.4, W * 1.6, -L, 0);
        cr.closePath();

        if (mask) {
            cr.setSourceRGBA(0, 0, 0, 1);
            cr.fill();
        } else if (shadow) {
            cr.setSourceRGBA(0, 0.03, 0.06, alpha);
            cr.fill();
        } else {
            // lá ngấm nước thì sẫm và ngả màu nước dần trước khi chìm
            const c = this.soak > 0.02 && this.state === 'water'
                ? mix3(this.color, [0.07, 0.28, 0.28], clamp(this.soak, 0, 1) * 0.45)
                : this.color;
            const fa = falling ? this.fade : 1;
            cr.setSourceRGBA(c[0], c[1], c[2], 0.95 * fa);
            cr.fill();
            cr.newPath();
            cr.moveTo(-L, 0);
            cr.lineTo(L * 0.9, 0);
            cr.setLineWidth(1);
            cr.setSourceRGBA(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 0.6 * fa);
            cr.stroke();
        }
        cr.restore();
    }
}

// ───────────── Rong dưới đáy (nhìn từ trên xuống, đong đưa theo dòng) ─────────────
class Weed {
    constructor(pond) {
        const u = pond.u;
        this.pond = pond;
        this.x = rand(0.04, 0.96) * pond.w;
        this.y = rand(0.04, 0.96) * pond.h;
        const n = 4 + Math.floor(_rng() * 3);
        const a0 = rand(0, TAU);
        this.blades = Array.from({length: n}, (_, i) => {
            const s = _rng();
            return {
                ang: a0 + i * TAU / n + rand(-0.3, 0.3),
                len: rand(20, 34) * u,
                ph: rand(0, TAU),
                wd: rand(2.2, 3.2) * u,
                col: [0.05 + s * 0.06, 0.28 + s * 0.14, 0.20 + s * 0.06],
            };
        });
    }

    draw(cr) {
        const p = this.pond;
        const t = p.t;
        const u = p.u;
        const [fx, fy] = p.flow(this.x, this.y);
        const m = Math.max(FLOW_SPEED * u, 0.0001);
        const lx = fx / m, ly = fy / m;

        for (const b of this.blades) {
            const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
            cr.newPath();
            cr.moveTo(this.x, this.y);
            for (let k = 1; k <= 6; k++) {
                const s = k / 6;
                const sway = Math.sin(t * 1.1 + b.ph + s * 2.0) * b.len * 0.14 * s;
                cr.lineTo(
                    this.x + dx * b.len * s - dy * sway + lx * b.len * 0.3 * s * s,
                    this.y + dy * b.len * s + dx * sway + ly * b.len * 0.3 * s * s);
            }
            cr.setLineWidth(lw(b.wd));
            cr.setSourceRGBA(b.col[0], b.col[1], b.col[2], 0.85);
            cr.stroke();
        }
    }
}

// ───────────── Ao ─────────────
class Pond {
    constructor(w, h, seed = 1, snap = null) {
        this.w = w;
        this.h = h;
        this.seed = seed;
        // số lượng lúc dựng (snapshot dùng để biết cần thêm / bớt bao nhiêu vật)
        const roster = FISH_ROSTER.length ? FISH_ROSTER : null;   // cá tuỳ chỉnh (rỗng => cá mặc định)
        const nFish = roster ? roster.length : FISH_COUNT;
        this.counts = {fish: nFish, pad: PAD_COUNT, leaf: LEAF_COUNT, weed: WEED_COUNT};
        this.u = w / 960;
        this.t = 0;
        this.ripples = [];
        this.nextDrop = rand(1, 3);
        this.fallingDrops = [];      // giọt mưa đang rơi xuống mặt nước
        this.grab = null;            // vật đang bị chuột kéo {obj, ox, oy, x, y}
        // Mỗi loại vật (và mỗi con cá / cụm rong) có luồng ngẫu nhiên riêng theo seed,
        // nên đổi số lượng loại này không làm xáo trộn các loại khác.
        this.fish = Array.from({length: nFish}, (_, i) =>
            withSeed(hashSeed(seed, 'fish', i), () => new Fish(this, i, roster ? roster[i] : null)));

        // rải lá sen sao cho không đè lên nhau ngay từ khung hình đầu
        this.pads = [];
        withSeed(hashSeed(seed, 'pad'), () => {
            for (let i = 0; i < PAD_COUNT; i++) {
                let pad = new Pad(this);
                for (let k = 0; k < 80; k++) {
                    if (this._padsClear(pad))
                        break;
                    pad = new Pad(this);
                }
                this.pads.push(pad);
            }
        });

        // rải lá rụng: không đè lá sen, không đè nhau
        this.leaves = [];
        withSeed(hashSeed(seed, 'leaf'), () => {
            for (let i = 0; i < LEAF_COUNT; i++) {
                const leaf = new Leaf(this);
                for (let k = 0; k < 80; k++) {
                    leaf.x = rand(0.03, 0.97) * this.w;
                    leaf.y = rand(0.03, 0.97) * this.h;
                    if (this._leafClear(leaf))
                        break;
                }
                this.leaves.push(leaf);
            }

            // một phần số lá đã "rụng" sẵn trên mặt lá sen, phần còn lại trôi trên nước
            let onPad = 0;
            const wantOnPad = Math.max(1, Math.round(LEAF_COUNT * 0.3));
            for (const leaf of this.leaves) {
                if (onPad >= wantOnPad)
                    break;
                const free = this.pads.filter(pd => this._leafCount(pd) < LEAF_PER_PAD);
                if (!free.length)
                    break;
                leaf.placeOnPad(free[Math.floor(_rng() * free.length)]);
                onPad++;
            }
        });

        // dọn nốt các chỗ chồng lấn (phòng khi chỗ rải ngẫu nhiên bị chật)
        for (let i = 0; i < 8; i++)
            this._resolveFloating();

        this.weeds = Array.from({length: WEED_COUNT}, (_, i) =>
            withSeed(hashSeed(seed, 'weed', i), () => new Weed(this)));
        this._wet = [];      // lá đang trôi trên mặt nước
        this._dry = [];      // lá đang đậu trên lá sen / đang rơi
        this._sink = [];     // lá đang chìm dưới nước
        this._spawnT = rand(LEAF_SPAWN_MIN, LEAF_SPAWN_MAX);   // đếm ngược tới lá rơi tiếp theo
        this._initWaves();
        this._initLight();
        this._buildCache();

        // đổi cài đặt: áp lại trạng thái của bể cũ (sóng đang lan thì bỏ)
        if (snap) {
            try {
                this._restore(snap);
            } catch (e) {
                logError(e, 'koipond restore');
            }
        }
    }

    // ───── Chụp / áp lại trạng thái ─────
    // Vị trí lưu theo tỉ lệ so với bể, độ dài theo đơn vị u => dùng được cả khi đổi pixel size.
    snapshot() {
        const {w, h, u} = this;
        const padIdx = new Map(this.pads.map((p, i) => [p, i]));
        return {
            counts: {...this.counts},
            t: this.t,
            spawnT: this._spawnT,
            fish: this.fish.map(f => ({
                x: f.x / w, y: f.y / h, angle: f.angle,
                size: f.size / u, base: f.base / u, speed: f.speed / u,
                turn: f.turn, phase: f.phase,
                zBase: f.zBase / u, zTarget: f.zTarget / u, zT: f.zT, actT: f.actT,
                action: f.action ? {...f.action} : null, turnTarget: f.turnTarget,
                segs: f.segs.map(g => [g.x / w, g.y / h]),
            })),
            pads: this.pads.map(p => ({
                x: p.x / w, y: p.y / h, r: p.r / u, a: p.a, ph: p.ph, pulse: p.pulse,
                flower: p.flower, notch: p.notch, vx: p.vx / u, vy: p.vy / u, av: p.av,
            })),
            leaves: this.leaves.filter(l => !l.dead).map(l => ({
                x: l.x / w, y: l.y / h, vx: l.vx / u, vy: l.vy / u, vz: l.vz / u,
                len: l.len / u, a: l.a, av: l.av, spin: l.spin, ph: l.ph, color: l.color,
                state: l.state, home: l.home ? (padIdx.get(l.home) ?? -1) : -1,
                h: l.h / u, wetLimit: l.wetLimit, wetT: l.wetT, sinkWait: l.sinkWait,
                sinkT: l.sinkT, fade: l.fade, soak: l.soak, bedTilt: l.bedTilt,
                bedFade: l.bedFade, retire: l.retire,
            })),
        };
    }

    _restore(snap) {
        const {w, h, u} = this;
        this.t = snap.t;
        this._spawnT = snap.spawnT;

        // cá: con nào còn thì giữ nguyên trạng thái, con mới thêm giữ vị trí tạo từ seed
        const nf = Math.min(snap.fish.length, this.fish.length);
        for (let i = 0; i < nf; i++) {
            const s = snap.fish[i], f = this.fish[i];
            f.x = s.x * w; f.y = s.y * h; f.angle = s.angle;
            f.size = s.size * u; f.base = s.base * u; f.speed = s.speed * u;
            f.turn = s.turn; f.phase = s.phase;
            f.zBase = s.zBase * u; f.zTarget = s.zTarget * u; f.zT = s.zT; f.actT = s.actT;
            f.action = s.action ? {...s.action} : null;
            f.turnTarget = s.turnTarget;
            f.spacing = f.size * f.spacingK;
            f.zH = f.size * FISH_THICK;
            if (s.segs.length === f.nseg)      // loài khác số đốt (đổi file ở vị trí này) thì giữ xương mới dựng
                f.segs = s.segs.map(([x, y]) => ({x: x * w, y: y * h}));
        }

        // lá sen
        const np = Math.min(snap.pads.length, this.pads.length);
        for (let i = 0; i < np; i++) {
            const s = snap.pads[i], p = this.pads[i];
            p.x = s.x * w; p.y = s.y * h; p.r = s.r * u; p.a = s.a; p.ph = s.ph;
            p.pulse = s.pulse; p.flower = s.flower; p.notch = s.notch;
            p.vx = s.vx * u; p.vy = s.vy * u; p.av = s.av;
            p.mass = p.r * p.r * 4;
            p.invMass = 1 / p.mass;
        }
        // lá sen thêm mới: tìm chỗ trống, không đè lá sen đang có
        withSeed(hashSeed(this.seed, 'padfix'), () => {
            for (let i = np; i < this.pads.length; i++) {
                const pad = this.pads[i];
                const clear = () => this.pads.every(q => q === pad ||
                    Math.hypot(pad.x - q.x, pad.y - q.y) > (pad.r + q.r) * PAD_GAP);
                for (let k = 0; k < 80 && !clear(); k++) {
                    pad.x = rand(0.08, 0.92) * w;
                    pad.y = rand(0.08, 0.92) * h;
                }
            }
        });

        // lá rụng: lấy lại toàn bộ lá cũ (kể cả lá dưới đáy), rồi thêm / bớt theo chênh lệch số lượng
        const seeded = this.leaves;
        const restored = snap.leaves.map(s => {
            const l = new Leaf(this);
            l.x = s.x * w; l.y = s.y * h;
            l.vx = s.vx * u; l.vy = s.vy * u; l.vz = s.vz * u;
            l.len = s.len * u;
            l.rad = l.len * 0.5;
            l.mass = l.len * l.len;
            l.invMass = 1 / l.mass;
            l.invI = 1 / (l.mass * l.len * l.len * 0.22);
            l.a = s.a; l.av = s.av; l.spin = s.spin; l.ph = s.ph; l.color = s.color;
            l.state = s.state;
            l.h = s.h * u;
            l.wetLimit = s.wetLimit; l.wetT = s.wetT; l.sinkWait = s.sinkWait;
            l.sinkT = s.sinkT; l.fade = s.fade; l.soak = s.soak;
            l.bedTilt = s.bedTilt; l.bedFade = s.bedFade; l.retire = s.retire;
            l.home = null;
            if (s.state === 'pad') {
                const home = this.pads[s.home];
                if (home) {
                    l.home = home;
                    l._padX = home.x; l._padY = home.y; l._padA = home.a;
                } else {
                    // lá sen đã bị bớt: lá rơi xuống nước
                    l.state = 'water';
                    l.h = 0; l.vx = 0; l.vy = 0; l.vz = 0;
                }
            }
            return l;
        });

        const delta = this.counts.leaf - snap.counts.leaf;
        if (delta < 0) {
            // bớt lá: bỏ các lá còn nổi, từ cuối danh sách
            let drop = -delta;
            for (let i = restored.length - 1; i >= 0 && drop > 0; i--) {
                const st = restored[i].state;
                if (st !== 'sink' && st !== 'bed') {
                    restored.splice(i, 1);
                    drop--;
                }
            }
        }
        this.leaves = restored;
        if (delta > 0) {
            // thêm lá: đặt xuống nước ở chỗ trống (vị trí chọn theo seed)
            withSeed(hashSeed(this.seed, 'leaffix'), () => {
                for (const leaf of seeded.slice(snap.counts.leaf, this.counts.leaf)) {
                    leaf.state = 'water';
                    leaf.home = null;
                    leaf.h = 0; leaf.vx = 0; leaf.vy = 0; leaf.vz = 0;
                    for (let k = 0; k < 80; k++) {
                        leaf.x = rand(0.03, 0.97) * w;
                        leaf.y = rand(0.03, 0.97) * h;
                        if (this._leafClear(leaf))
                            break;
                    }
                    this.leaves.push(leaf);
                }
            });
        }

        // dọn nốt chỗ chồng lấn còn sót
        for (let i = 0; i < 8; i++)
            this._resolveFloating();
    }

    // ───── Rải chỗ ban đầu ─────
    _padsClear(pad) {
        return this.pads.every(q =>
            Math.hypot(pad.x - q.x, pad.y - q.y) > (pad.r + q.r) * PAD_GAP);
    }

    _leafClear(leaf) {
        const [ax, ay, bx, by] = leaf.capsule();
        for (const pad of this.pads) {
            const [px, py] = closestPointOnSeg(pad.x, pad.y, ax, ay, bx, by);
            if (Math.hypot(px - pad.x, py - pad.y) < pad.r * PAD_GAP + leaf.rad)
                return false;
        }
        for (const o of this.leaves) {
            const oc = o.capsule();
            const c = closestOnSegments(ax, ay, bx, by, oc[0], oc[1], oc[2], oc[3]);
            if (c.d < leaf.rad + o.rad + 1.5 * this.u)
                return false;
        }
        return true;
    }

    _leafCount(pad) {
        let n = 0;
        for (const l of this.leaves) {
            if (l.home === pad)
                n++;
        }
        return n;
    }

    // Nhường chỗ cho lá mới: lá trôi trên mặt nước lâu nhất bắt đầu ngấm nước chìm
    _sinkOldest() {
        let best = null;
        for (const l of this.leaves) {
            if (l.state !== 'water' || l.dead)
                continue;
            if (!best || l.wetT > best.wetT)
                best = l;
        }
        if (!best)
            return false;
        best._startSink();
        return true;
    }

    // ───── Va chạm giữa các vật nổi ─────
    // Lá đang trôi trên mặt nước chạm mép lá sen: bật ra như đụng vật cản.
    // (Lá chỉ lên được mặt lá sen bằng cách RƠI từ trên xuống, không "bay" lên từ dưới nước.)
    _leafPadContact(leaf, pad) {
        if (leaf.state !== 'water')
            return;   // lá đang bay/chìm/đậu trên lá sen thì không va với mép lá sen
        const [ax, ay, bx, by] = leaf.capsule();
        const [px, py] = closestPointOnSeg(pad.x, pad.y, ax, ay, bx, by);
        let nx = px - pad.x, ny = py - pad.y;
        const d = Math.hypot(nx, ny);
        const minD = pad.r * 0.94 + leaf.rad;
        if (d >= minD || d < 1e-6)
            return;
        nx /= d;
        ny /= d;
        // đụng mép lá sen: lá bị nhúng nước
        const rel = Math.hypot(leaf.vx - pad.vx, leaf.vy - pad.vy);
        leaf.soak += clamp(rel / (60 * this.u), 0, 1) * LEAF_SOAK_BUMP;
        resolveContact(pad, leaf, nx, ny, minD - d, px, py, LEAF_REST, LEAF_FRICTION);
    }

    // Hai lá rụng cùng tầng: cùng trôi trên mặt nước, hoặc cùng đậu trên một lá sen
    _leafLeafContact(a, b) {
        const aq = a.state === 'water' || a.state === 'pad';
        const bq = b.state === 'water' || b.state === 'pad';
        if (!aq || !bq || a.home !== b.home)
            return;
        const ca = a.capsule(), cb = b.capsule();
        const c = closestOnSegments(ca[0], ca[1], ca[2], ca[3], cb[0], cb[1], cb[2], cb[3]);
        const minD = a.rad + b.rad;
        if (c.d >= minD)
            return;
        // hai lá va nhau trên mặt nước: cả hai bị nhúng nước (lá đậu trên lá sen thì khô, không tính)
        if (a.state === 'water' && b.state === 'water') {
            const s = clamp(Math.hypot(a.vx - b.vx, a.vy - b.vy) / (60 * this.u), 0, 1) * LEAF_SOAK_BUMP;
            a.soak += s;
            b.soak += s;
        }
        resolveContact(a, b, c.nx, c.ny, minD - c.d,
            (c.px + c.qx) * 0.5, (c.py + c.qy) * 0.5, LEAF_REST, LEAF_FRICTION);
    }

    _resolveFloating() {
        const {pads, leaves} = this;

        // lá sen không đè lên nhau
        for (let it = 0; it < 3; it++) {
            for (let i = 0; i < pads.length; i++) {
                for (let j = i + 1; j < pads.length; j++) {
                    const a = pads[i], b = pads[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const d = Math.hypot(dx, dy);
                    const minD = (a.r + b.r) * PAD_GAP;
                    if (d >= minD || d < 1e-6)
                        continue;
                    const nx = dx / d, ny = dy / d;
                    resolveContact(a, b, nx, ny, minD - d,
                        a.x + nx * a.r, a.y + ny * a.r, PAD_REST, PAD_FRICTION);
                }
            }
        }

        // lá rụng với lá sen, rồi lá rụng với nhau
        for (let it = 0; it < 4; it++) {
            for (const leaf of leaves) {
                if (leaf.state !== 'water')
                    continue;
                for (const pad of pads)
                    this._leafPadContact(leaf, pad);
            }
            for (let i = 0; i < leaves.length; i++) {
                for (let j = i + 1; j < leaves.length; j++)
                    this._leafLeafContact(leaves[i], leaves[j]);
            }
        }
    }

    // Cá cùng tầng (khoảng độ cao chồng nhau) không được xuyên qua nhau: đẩy rời nhau, con nhỏ bị đẩy nhiều hơn.
    // Cá khác tầng thì bơi chồng lên nhau thoải mái.
    _resolveFish() {
        const fs = this.fish;
        for (let it = 0; it < 3; it++) {
            for (let i = 0; i < fs.length; i++) {
                for (let j = i + 1; j < fs.length; j++) {
                    const a = fs[i], b = fs[j];
                    if (!a.zOverlaps(b))
                        continue;
                    const c = fishContact(a, b);
                    if (!c || c.pen <= 0.3)
                        continue;
                    const ma = a.size * a.size, mb = b.size * b.size;
                    const corr = (c.pen - 0.3) * 0.8;
                    const ka = mb / (ma + mb), kb = ma / (ma + mb);
                    a.shift(-c.nx * corr * ka, -c.ny * corr * ka);
                    b.shift(c.nx * corr * kb, c.ny * corr * kb);
                    if (it === 0) {
                        a.bump(-c.nx, -c.ny);
                        b.bump(c.nx, c.ny);
                    }
                }
            }
        }
    }

    // Nền nước và vignette không đổi theo thời gian => vẽ một lần, dùng lại mỗi frame
    _buildCache() {
        const {w, h} = this;
        const A = WATER_OPACITY;

        this._bg = withSeed(hashSeed(this.seed, 'bottom'), () => this._makeBottom());

        let cr;

        this._vig = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        cr = new Cairo.Context(this._vig);
        const v = new Cairo.RadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
        v.addColorStopRGBA(0, 0, 0.05, 0.1, 0);
        v.addColorStopRGBA(1, 0, 0.04, 0.09, 0.45 * A);
        cr.setSource(v);
        cr.paint();
        cr.$dispose();
    }

    // Đáy bể: cát, sỏi, đá, rồi phủ lớp nước xanh lên trên (vẽ một lần)
    _makeBottom() {
        const {w, h, u} = this;
        const k = u * 2;    // = 1 khi ao rộng 480px, giữ kích thước sỏi/đá ổn định theo PIXEL_SIZE
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        const cr = new Cairo.Context(surf);
        cr.setAntialias(Cairo.Antialias.NONE);

        // cát
        const sand = new Cairo.LinearGradient(0, 0, w, h);
        sand.addColorStopRGBA(0.0, 0.62, 0.56, 0.42, 1);
        sand.addColorStopRGBA(0.5, 0.48, 0.43, 0.33, 1);
        sand.addColorStopRGBA(1.0, 0.34, 0.31, 0.25, 1);
        cr.setSource(sand);
        cr.paint();

        // hạt cát lấm tấm
        const specks = Math.round(w * h / 35);
        for (let i = 0; i < specks; i++) {
            cr.rectangle(Math.floor(rand(0, w)), Math.floor(rand(0, h)), 1, 1);
            if (_rng() < 0.5)
                cr.setSourceRGBA(1, 0.95, 0.8, 0.10);
            else
                cr.setSourceRGBA(0.1, 0.07, 0.03, 0.12);
            cr.fill();
        }

        // sỏi nhỏ
        const pebbleColors = [
            [0.55, 0.52, 0.48], [0.40, 0.36, 0.32], [0.68, 0.62, 0.52], [0.45, 0.42, 0.36],
        ];
        const pebbles = Math.round(w * h / 700);
        for (let i = 0; i < pebbles; i++) {
            const x = rand(0, w), y = rand(0, h);
            const r = rand(1.2, 3.4) * k;
            const c = pebbleColors[Math.floor(_rng() * pebbleColors.length)];
            cr.save();
            cr.translate(x, y);
            cr.rotate(rand(0, TAU));
            cr.scale(r, r * rand(0.6, 0.9));
            cr.newPath();
            cr.arc(0, 0, 1, 0, TAU);
            cr.restore();
            cr.setSourceRGBA(c[0], c[1], c[2], 0.9);
            cr.fill();
            cr.rectangle(Math.floor(x - r * 0.4), Math.floor(y - r * 0.4), 1, 1);
            cr.setSourceRGBA(1, 1, 0.95, 0.35);
            cr.fill();
        }

        // đá lớn: bóng, thân, mảng sáng
        for (let i = 0; i < 8; i++) {
            const x = rand(0.03, 0.97) * w, y = rand(0.05, 0.95) * h;
            const r = rand(7, 14) * k;
            const rot = rand(0, TAU);
            const blob = (ox, oy, sx, sy, rgba) => {
                cr.save();
                cr.translate(x + ox, y + oy);
                cr.rotate(rot);
                cr.scale(r * sx, r * sy);
                cr.newPath();
                cr.arc(0, 0, 1, 0, TAU);
                cr.restore();
                cr.setSourceRGBA(...rgba);
                cr.fill();
            };
            blob(r * 0.25, r * 0.3, 1.0, 0.8, [0.05, 0.04, 0.02, 0.28]);
            blob(0, 0, 1.0, 0.8, [0.30, 0.30, 0.29, 1]);
            blob(-r * 0.12, -r * 0.14, 0.75, 0.6, [0.42, 0.42, 0.40, 1]);
            blob(-r * 0.25, -r * 0.28, 0.4, 0.3, [0.56, 0.56, 0.52, 0.7]);
        }

        // lớp nước phủ lên đáy (sâu dần về góc dưới phải)
        const tint = new Cairo.LinearGradient(0, 0, w, h);
        tint.addColorStopRGBA(0.0, 0.10, 0.45, 0.52, 0.62);
        tint.addColorStopRGBA(0.5, 0.05, 0.30, 0.42, 0.70);
        tint.addColorStopRGBA(1.0, 0.02, 0.16, 0.28, 0.80);
        cr.setSource(tint);
        cr.paint();

        cr.$dispose();
        return surf;
    }

    // ───── Ánh sáng: màu theo giờ, vệt sáng và lấp lánh trên mặt nước ─────
    _initLight() {
        this.setHour(12);
        // các điểm lấp lánh cố định, mỗi điểm nhấp nháy theo nhịp riêng
        const n = GLITTER ? Math.round(this.w * this.h / 450) : 0;
        this._spk = withSeed(hashSeed(this.seed, 'glitter'), () => Array.from({length: n}, () => ({
            x: rand(0, this.w),
            y: rand(0, this.h),
            ph: rand(0, TAU),
            sp: rand(1.2, 3.2),
        })));
        this._gs = [];
        this._gb = [];
    }

    setHour(hour) {
        this.hour = hour;
        this.light = lightAt(hour);
    }

    // Chỗ mặt nước chói nhất: nguồn sáng càng thấp thì càng lệch ra phía nguồn sáng
    _lightSpot() {
        const L = this.light;
        const dist = (1 - L.elev) * 0.42 * this.w;
        return [this.w / 2 + L.dx * dist, this.h / 2 + L.dy * dist];
    }

    // Quầng sáng bản rộng trên mặt nước (3 lớp phẳng cho hợp pixel art)
    // Đường đi của mặt trời / mặt trăng trên màn hình: mọc bên trái (đông), đi qua giữa, lặn bên phải (tây).
    // Cả hai đều đi theo vòng cung lệch xuống dưới (nam) như trên bầu trời thật.
    // k: 0 = lúc mọc, 1 = lúc lặn.
    _skyPos(k) {
        const x = 0.5 - 0.42 * Math.cos(Math.PI * k);
        const y = 0.30 + 0.40 * Math.sin(Math.PI * k);
        return [x * this.w, y * this.h];
    }

    // Vẽ một ảnh, tâm tại (cx, cy), cạnh lớn nhất = size (đơn vị pixel của ao)
    _blit(cr, img, cx, cy, size, alpha) {
        const iw = img.getWidth(), ih = img.getHeight();
        if (!iw || !ih || alpha <= 0.01)
            return;
        const sc = size / Math.max(iw, ih);
        cr.save();
        cr.translate(Math.round(cx), Math.round(cy));
        cr.scale(sc, sc);
        cr.setSourceSurface(img, -iw / 2, -ih / 2);
        try {
            cr.getSource().setFilter(Cairo.Filter.NEAREST);   // giữ nét pixel vuông
        } catch (_e) { /* bản cairo cũ */ }
        cr.paintWithAlpha(clamp(alpha, 0, 1));
        cr.restore();
    }

    // Vẽ ảnh PNG như một BÓNG trên mặt nước, tâm (cx, cy), cạnh lớn nhất = size (pixel ao).
    // Ảnh được cắt thành từng hàng pixel, mỗi hàng chia thành các mảnh rộng REFLECT_SEG; mỗi mảnh bị
    // dịch ngang/dọc theo (1) độ nghiêng của sóng thật trên lưới độ cao và (2) sóng lăn tăn nhỏ liên tục
    // => hình bị kéo giãn, vỡ vụn, nhấp nháy theo mặt nước. Có thêm glow phía sau.
    // Bản có cache: phần méo/vỡ tốn kém chỉ dựng lại ~6 lần/giây vào một surface phụ,
    // các frame còn lại chỉ paint surface đó một lần.
    _blitWater(cr, img, cx, cy, size, alpha, glowCol, glowK, slot = 0) {
        if (alpha <= 0.01)
            return;
        this._celCache = this._celCache ?? [];
        let c = this._celCache[slot];
        if (!c) {
            c = this._celCache[slot] = {
                surf: new Cairo.ImageSurface(Cairo.Format.ARGB32, this.w, this.h),
                tf: -1,
                img: null,
            };
        }
        const tf = Math.floor(this.t * 6);
        if (c.tf !== tf || c.img !== img) {
            c.tf = tf;
            c.img = img;
            const cc = new Cairo.Context(c.surf);
            cc.setAntialias(Cairo.Antialias.NONE);
            cc.setOperator(Cairo.Operator.CLEAR);
            cc.paint();
            cc.setOperator(Cairo.Operator.OVER);
            this._renderWater(cc, img, cx, cy, size, alpha, glowCol, glowK);
            cc.$dispose();
        }
        cr.setSourceSurface(c.surf, 0, 0);
        cr.paint();
    }

    _renderWater(cr, img, cx, cy, size, alpha, glowCol, glowK) {
        const iw = img.getWidth(), ih = img.getHeight();
        if (!iw || !ih || alpha <= 0.01)
            return;
        const sc = size / Math.max(iw, ih);
        const dw = iw * sc, dh = ih * sc;
        const left = Math.floor(cx - dw / 2), top = Math.floor(cy - dh / 2);
        const t = this.t;

        // glow (chuyển dần, nhịp nhẹ theo thời gian)
        if (GLOW && glowK > 0.01) {
            const gr = size * GLOW_SIZE / 2 * (1 + 0.05 * Math.sin(t * 1.3));
            const ga = GLOW_OPACITY * glowK * alpha;
            const g = new Cairo.RadialGradient(cx, cy, 0, cx, cy, gr);
            g.addColorStopRGBA(0.00, glowCol[0], glowCol[1], glowCol[2], ga);
            g.addColorStopRGBA(0.30, glowCol[0], glowCol[1], glowCol[2], ga * 0.55);
            g.addColorStopRGBA(0.65, glowCol[0], glowCol[1], glowCol[2], ga * 0.18);
            g.addColorStopRGBA(1.00, glowCol[0], glowCol[1], glowCol[2], 0);
            cr.save();
            cr.setSource(g);
            cr.newPath();
            cr.arc(cx, cy, gr, 0, TAU);
            cr.fill();
            cr.restore();
        }

        const {gw, gh, wh, mask} = this;
        const C = WAVE_CELL;
        const calm = this.waveEnergy < WAVE_REST;
        const amp = dw * 0.10 * SHIMMER;
        const seg = Math.max(2, Math.round(REFLECT_SEG));
        const nseg = Math.max(1, Math.ceil(dw / seg));
        const rows = Math.ceil(dh);
        const tf = Math.floor(t * 6);
        const mx = dw * 0.4, my = dh * 0.15;

        for (let r = 0; r < rows; r++) {
            const y = top + r;
            for (let s = 0; s < nseg; s++) {
                const xs = left + s * seg;
                let sx = 0, sy = 0;
                if (!calm) {
                    const gx = clamp(Math.floor((xs + seg / 2) / C), 1, gw - 2);
                    const gy = clamp(Math.floor(y / C), 1, gh - 2);
                    const gi = gy * gw + gx;
                    if (!mask[gi]) {
                        sx = wh[gi - 1] - wh[gi + 1];
                        sy = wh[gi - gw] - wh[gi + gw];
                    }
                }
                const ox = amp * (Math.sin(y * 0.55 + t * 1.9) * 0.7 + Math.sin(y * 0.23 - t * 1.1 + s * 0.9) * 0.5)
                    + clamp(sx * WAVE_DISTORT, -mx, mx);
                const oy = clamp(sy * WAVE_DISTORT, -my, my);

                // nhấp nháy: sóng càng dốc, càng nhiều mảnh tối đi
                let n = Math.sin(s * 12.9898 + y * 78.233 + tf * 37.719) * 43758.5453;
                n -= Math.floor(n);
                const drop = 0.05 + Math.min(0.4, (Math.abs(sx) + Math.abs(sy)) * 3);
                const a = alpha * (n < drop ? 0.25 : 1);

                cr.save();
                cr.rectangle(xs, y, seg, 1);
                cr.clip();
                cr.translate(Math.round(left + ox), Math.round(top - oy));
                cr.scale(sc, sc);
                cr.setSourceSurface(img, 0, 0);
                try {
                    cr.getSource().setFilter(Cairo.Filter.NEAREST);   // giữ nét pixel vuông
                } catch (_e) { /* bản cairo cũ */ }
                cr.paintWithAlpha(clamp(a, 0, 1));
                cr.restore();
            }
        }
    }

    // Có ảnh trong sun/ hoặc moon/ không?
    _hasCelestial() {
        return listFrames(SUN_DIR).length > 0 || listFrames(MOON_DIR).length > 0;
    }

    // Mặt trời và mặt trăng theo giờ:
    //  - Mặt trời: mọc SUNRISE, lặn SUNSET. Nếu sun/ có nhiều ảnh thì chia đều theo ngày (ảnh đầu = bình minh, ảnh cuối = hoàng hôn).
    //  - Mặt trăng: giờ mọc/lặn phụ thuộc pha. Trăng rằm mọc lúc mặt trời lặn, trăng non đi cùng mặt trời (không thấy),
    //    thượng huyền thì thấy từ chiều. Ảnh chọn theo tuổi trăng hôm nay, chia đều các ảnh trong moon/ (ảnh đầu = non).
    _drawCelestial(cr) {
        const sunFrames = listFrames(SUN_DIR);
        const moonFrames = listFrames(MOON_DIR);
        if (!sunFrames.length && !moonFrames.length)
            return false;

        const hour = this.hour;
        const dayLen = SUNSET - SUNRISE;
        const ks = (hour - SUNRISE) / dayLen;
        const sunUp = ks >= 0 && ks <= 1;
        const edge = k => clamp(Math.min(k, 1 - k) / 0.10, 0, 1);   // mờ dần khi sát chân trời

        // mặt trăng (vẽ trước, mặt trời đè lên nếu chồng nhau)
        if (moonFrames.length) {
            const age = moonAge();
            const illum = (1 - Math.cos(TAU * age / SYNODIC)) / 2;   // 0 = non, 1 = rằm
            if (!(NEW_MOON_HIDDEN && illum < 0.02)) {
                const transit = (SUNRISE + SUNSET) / 2 + age / SYNODIC * 24;   // giờ trăng lên cao nhất
                const start = transit - MOON_UP_HOURS / 2;
                const km = ((((hour - start) % 24) + 24) % 24) / MOON_UP_HOURS;
                if (km <= 1) {
                    const idx = Math.round(age / SYNODIC * moonFrames.length) % moonFrames.length;
                    const img = getImage(moonFrames[idx]);
                    if (img) {
                        const sunElev = sunUp ? Math.sin(Math.PI * ks) : 0;
                        const dim = 1 - 0.55 * clamp(sunElev * 3, 0, 1);   // ban ngày trăng nhạt hơn
                        const [x, y] = this._skyPos(km);
                        this._blitWater(cr, img, x, y, this.w * MOON_SIZE,
                            edge(km) * dim * CELESTIAL_OPACITY,
                            [0.80, 0.90, 1.00], 0.3 + 0.7 * illum, 0);
                    }
                }
            }
        }

        // mặt trời
        if (sunFrames.length && sunUp) {
            const idx = Math.min(sunFrames.length - 1, Math.floor(ks * sunFrames.length));
            const img = getImage(sunFrames[idx]);
            if (img) {
                const [x, y] = this._skyPos(ks);
                this._blitWater(cr, img, x, y, this.w * SUN_SIZE, edge(ks) * CELESTIAL_OPACITY,
                    mix3(this.light.lc, [1, 0.95, 0.80], 0.4), 1, 1);
            }
        }
        return true;
    }

    _drawGlare(cr) {
        if (CELESTIAL && this._hasCelestial()) {
            if (!CELESTIAL_ON_TOP)
                this._drawCelestial(cr);
            return;
        }
        // tới đây nghĩa là CELESTIAL tắt hoặc chưa có ảnh trong sun/ moon/ (khi đó dùng quầng sáng dự phòng)
        if (!CELESTIAL && !GLARE)
            return;
        const L = this.light;
        const [gx, gy] = this._lightSpot();
        const ang = Math.atan2(L.dy, L.dx);
        const a = 0.05 * L.ls;
        for (const sc of [1.0, 0.62, 0.30]) {
            cr.save();
            cr.translate(gx, gy);
            cr.rotate(ang);
            cr.scale(this.w * 0.30 * sc, this.w * 0.15 * sc);
            cr.newPath();
            cr.arc(0, 0, 1, 0, TAU);
            cr.restore();
            cr.setSourceRGBA(L.lc[0], L.lc[1], L.lc[2], a);
            cr.fill();
        }
    }

    // Lấp lánh: điểm sáng nhấp nháy, dày đặc nhất quanh vệt chói, mỏng hơn ở chỗ khác
    _drawGlitter(cr) {
        if (!GLITTER)
            return;
        const L = this.light;
        const t = this.t;
        const [gx, gy] = this._lightSpot();
        const ang = Math.atan2(L.dy, L.dx);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rx = this.w * 0.30 * 1.3, ry = this.w * 0.15 * 1.3;
        const {gw, mask} = this;
        const small = this._gs, big = this._gb;
        small.length = 0;
        big.length = 0;

        for (const s of this._spk) {
            const tw = Math.sin(t * s.sp + s.ph);
            if (tw < 0.85)
                continue;
            const dx = s.x - gx, dy = s.y - gy;
            const al = (dx * ca + dy * sa) / rx;
            const pe = (-dx * sa + dy * ca) / ry;
            const g = 0.12 + 0.88 * Math.exp(-(al * al + pe * pe));
            const I = (tw - 0.85) / 0.15 * g * L.ls;
            if (I < 0.08)
                continue;
            const ix = Math.floor(s.x), iy = Math.floor(s.y);
            // không lấp lánh trên lá
            if (mask[Math.floor(iy / WAVE_CELL) * gw + Math.floor(ix / WAVE_CELL)])
                continue;
            (I > 0.5 ? big : small).push(ix, iy);
        }

        const c = mix3(L.lc, [1, 1, 1], 0.4);
        if (small.length) {
            cr.newPath();
            for (let j = 0; j < small.length; j += 2)
                cr.rectangle(small[j], small[j + 1], 1, 1);
            cr.setSourceRGBA(c[0], c[1], c[2], 0.6);
            cr.fill();
        }
        if (big.length) {
            cr.newPath();
            for (let j = 0; j < big.length; j += 2) {
                cr.rectangle(big[j] - 1, big[j + 1], 3, 1);
                cr.rectangle(big[j], big[j + 1] - 1, 1, 3);
            }
            cr.setSourceRGBA(c[0], c[1], c[2], 0.95);
            cr.fill();
        }
    }

    // Dòng nước tại một điểm (px/giây): hướng và tốc độ đổi chậm theo thời gian và vị trí
    flow(x, y) {
        const {u, t} = this;
        const th = 0.5
            + Math.sin(t * 0.07 + y * 0.006 / u) * 0.7
            + Math.sin(t * 0.05 + x * 0.004 / u) * 0.4;
        const sp = (0.7 + 0.3 * Math.sin(t * 0.11 + (x + y) * 0.0025 / u)) * FLOW_SPEED * u;
        return [Math.cos(th) * sp, Math.sin(th) * sp];
    }

    // ───── Sóng nước: lưới độ cao h, giải phương trình sóng 2D ─────
    // - Các sóng cộng chồng lên nhau tự nhiên => giao thoa (chỗ tăng cường, chỗ triệt tiêu).
    // - Lá/lá sen là vật cản: sóng dội lại ở mép và uốn vòng quanh (nhiễu xạ).
    // - Mép màn hình hút sóng nên không bị dội ngược.
    _initWaves() {
        this.gw = Math.max(8, Math.ceil(this.w / WAVE_CELL));
        this.gh = Math.max(8, Math.ceil(this.h / WAVE_CELL));
        const n = this.gw * this.gh;
        this.wp = new Float32Array(n);     // độ cao sóng bước trước
        this.wh = new Float32Array(n);     // độ cao sóng hiện tại
        this.wn = new Float32Array(n);     // độ cao sóng bước sau
        this.mask = new Uint8Array(n);     // 1 = ô bị vật nổi chiếm
        this.dm = new Float32Array(n);     // hệ số giữ vận tốc (tắt dần), mép nhỏ hơn
        for (let y = 0; y < this.gh; y++) {
            for (let x = 0; x < this.gw; x++) {
                const e = Math.min(x, y, this.gw - 1 - x, this.gh - 1 - y);
                const f = Math.min(1, e / WAVE_SPONGE);
                this.dm[y * this.gw + x] = 1 - WAVE_DAMP - (1 - f) * 0.3;
            }
        }
        this._stepAcc = 0;
        this.waveEnergy = 0;
        this._runs = [null, [], [], [], []];
    }

    _stampDisc(cx, cy, r) {
        const {gw, gh, mask} = this;
        const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(gw - 2, Math.ceil(cx + r));
        const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(gh - 2, Math.ceil(cy + r));
        const r2 = r * r;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= r2)
                    mask[y * gw + x] = 1;
            }
        }
    }

    _rasterObstacles() {
        this.mask.fill(0);
        const C = WAVE_CELL;
        for (const p of this.pads)
            this._stampDisc(p.x / C, p.y / C, p.r * 0.92 / C);
        for (const l of this.leaves) {
            if (l.state !== 'water')
                continue;   // lá đang rơi/chìm/đậu trên lá sen thì không chắn sóng
            this._stampDisc(l.x / C, l.y / C, Math.max(0.7, l.len * 0.5 / C));
        }
    }

    _injectDrop(x, y, amp) {
        const {gw, gh, wh: h, wp: hp, mask} = this;
        const cx = x / WAVE_CELL, cy = y / WAVE_CELL;
        const R = 5, s2 = 2 * 1.6 * 1.6;
        for (let gy = Math.floor(cy) - R; gy <= cy + R; gy++) {
            for (let gx = Math.floor(cx) - R; gx <= cx + R; gx++) {
                if (gx < 1 || gy < 1 || gx >= gw - 1 || gy >= gh - 1)
                    continue;
                const i = gy * gw + gx;
                if (mask[i])
                    continue;
                const d = (gx + 0.5 - cx) ** 2 + (gy + 0.5 - cy) ** 2;
                const v = amp * WAVE_DROP * Math.exp(-d / s2);
                // đổi cả h và hp để vận tốc ban đầu = 0: mặt nước lõm xuống rồi toả vòng ra
                h[i] -= v;
                hp[i] -= v;
            }
        }
        this.waveEnergy = Math.max(this.waveEnergy, 1);
    }

    _stepWaves(dt) {
        if (this.waveEnergy < WAVE_REST)
            return;     // mặt nước phẳng: khỏi tính (mask sẽ được dựng lại khi có giọt mới)
        this._rasterObstacles();
        this._stepAcc = Math.min(this._stepAcc + dt * WAVE_STEP_RATE, 8);
        const steps = Math.floor(this._stepAcc + 1e-6);   // +epsilon: tránh 0.9999999 làm lỡ bước
        this._stepAcc = Math.max(0, this._stepAcc - steps);
        for (let s = 0; s < steps; s++)
            this._step();
    }

    _step() {
        const {gw, gh, wh: h, wp: hp, wn: hn, mask, dm} = this;
        for (let y = 1; y < gh - 1; y++) {
            let i = y * gw + 1;
            for (let x = 1; x < gw - 1; x++, i++) {
                if (mask[i]) {
                    hn[i] = 0;
                    continue;
                }
                const c = h[i];
                // ô bên cạnh là vật cản thì coi như bằng chính nó => sóng bị phản xạ
                const l = mask[i - 1] ? c : h[i - 1];
                const r = mask[i + 1] ? c : h[i + 1];
                const u = mask[i - gw] ? c : h[i - gw];
                const d = mask[i + gw] ? c : h[i + gw];
                hn[i] = c + (c - hp[i]) * dm[i] + WAVE_C2 * (l + r + u + d - 4 * c);
            }
        }
        this.wp = h;
        this.wh = hn;
        this.wn = hp;
    }

    // Tô bóng mặt nước theo độ dốc của sóng (ánh sáng từ góc trên trái), chia vài mức cho ra pixel art
    _drawWaves(cr) {
        if (this.waveEnergy < WAVE_REST)
            return;
        const {gw, gh, wh: h, mask} = this;
        const C = WAVE_CELL;
        const runs = this._runs;
        // sáng chỗ mặt sóng nghiêng về phía nguồn sáng (mặt trời/trăng)
        const L = this.light;
        const lx = L.dx * 1.41, ly = L.dy * 1.41;
        for (let k = 1; k <= 4; k++)
            runs[k].length = 0;

        let maxAbs = 0;
        for (let y = 1; y < gh - 1; y++) {
            let runLevel = 0, runStart = 0;
            let i = y * gw + 1;
            for (let x = 1; x < gw - 1; x++, i++) {
                let level = 0;
                if (!mask[i]) {
                    const c = h[i];
                    const a = c < 0 ? -c : c;
                    if (a > maxAbs)
                        maxAbs = a;
                    const gxs = h[i - 1] - h[i + 1];
                    const gys = h[i - gw] - h[i + gw];
                    const s = gxs * lx + gys * ly;
                    if (s > WAVE_T2)
                        level = s > WAVE_T1 ? 4 : 3;
                    else if (s < -WAVE_T2)
                        level = s < -WAVE_T1 ? 2 : 1;
                    else if (Math.hypot(gxs, gys) > WAVE_T2 * 1.5)
                        level = c > 0 ? 3 : 1;   // hai bên hông (vuông góc hướng sáng): đỉnh sóng sáng nhạt, đáy sóng tối nhạt
                }
                if (level !== runLevel) {
                    if (runLevel)
                        runs[runLevel].push(runStart, y, x - runStart);
                    runLevel = level;
                    runStart = x;
                }
            }
            if (runLevel)
                runs[runLevel].push(runStart, y, gw - 1 - runStart);
        }

        this.waveEnergy = maxAbs;
        if (maxAbs < WAVE_REST) {
            this.wh.fill(0);
            this.wp.fill(0);
            return;
        }

        const hi1 = mix3(L.lc, [1, 1, 1], 0.2);
        const hi2 = mix3(L.lc, [1, 1, 1], 0.55);
        const sa = 0.35 + 0.65 * L.ls;   // ánh sáng yếu thì đường sáng cũng nhạt
        const COLORS = [null,
            [0.0, 0.10, 0.20, 0.16],                 // tối nhạt
            [0.0, 0.08, 0.18, 0.30],                 // tối đậm
            [hi1[0], hi1[1], hi1[2], 0.28 * sa],     // sáng nhạt
            [hi2[0], hi2[1], hi2[2], 0.50 * sa]];    // sáng đậm
        for (let k = 1; k <= 4; k++) {
            const arr = runs[k];
            if (!arr.length)
                continue;
            cr.newPath();
            for (let j = 0; j < arr.length; j += 3)
                cr.rectangle(arr[j] * C, arr[j + 1] * C, arr[j + 2] * C, C);
            const c = COLORS[k];
            cr.setSourceRGBA(c[0], c[1], c[2], c[3]);
            cr.fill();
        }
    }

    // Giữ vật nổi trong ao: gần mép có lực đẩy nhẹ ngược vào trong (để lá lượn lại thay vì dính mép),
    // và chặn cứng khi lấn ra quá `margin` px.
    confine(o, margin, dt) {
        const {w, h, u} = this;
        const zone = 40 * u;
        const K = 60 * u;
        if (o.x < zone) o.vx += (zone - o.x) / zone * K * dt;
        else if (o.x > w - zone) o.vx -= (o.x - (w - zone)) / zone * K * dt;
        if (o.y < zone) o.vy += (zone - o.y) / zone * K * dt;
        else if (o.y > h - zone) o.vy -= (o.y - (h - zone)) / zone * K * dt;

        if (o.x < -margin) { o.x = -margin; o.vx = Math.max(o.vx, 0); }
        else if (o.x > w + margin) { o.x = w + margin; o.vx = Math.min(o.vx, 0); }
        if (o.y < -margin) { o.y = -margin; o.vy = Math.max(o.vy, 0); }
        else if (o.y > h + margin) { o.y = h + margin; o.vy = Math.min(o.vy, 0); }
    }

    waveAt(x, y) {
        const gx = Math.floor(x / WAVE_CELL), gy = Math.floor(y / WAVE_CELL);
        if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh)
            return 0;
        return this.wh[gy * this.gw + gx];
    }

    // Lực sóng lên vật nổi bán kính rad (px ao): nước cao hơn ở phía nào thì đẩy ra phía đối diện.
    // Trả về [lực x, lực y, biên độ sóng quanh vật].
    waveForce(o, rad) {
        if (this.waveEnergy < WAVE_REST)
            return [0, 0, 0];
        const s = rad + WAVE_CELL * 1.5;
        // F = -(4/N) * sum(độ cao * pháp tuyến) quanh chu vi: với sóng dài bằng đúng (trái - phải, trên - dưới) như trước,
        // còn sóng ngắn (bước sóng nhỏ hơn vật) tự triệt tiêu thay vì bị lấy mẫu ngẫu nhiên ở 4 điểm xa nhau
        let fx = 0, fy = 0, m = 0;
        for (let k = 0; k < RING_N; k++) {
            const v = this.waveAt(o.x + RING_COS[k] * s, o.y + RING_SIN[k] * s);
            fx -= v * RING_COS[k];
            fy -= v * RING_SIN[k];
            const a = v < 0 ? -v : v;
            if (a > m)
                m = a;
        }
        return [fx * 4 / RING_N, fy * 4 / RING_N, m];
    }

    // Vận tốc mục tiêu mà sóng cuốn vật đi: tỉ lệ với độ dốc sóng khi sóng yếu, bão hoà mềm (tanh) khi sóng mạnh,
    // rồi làm mượt theo thời gian. Vật bám theo vận tốc này bằng cùng cơ chế trôi theo dòng nước.
    waveDrive(o, wx, wy, gain, vmax, dt) {
        const m = Math.hypot(wx, wy);
        let tx = 0, ty = 0;
        if (m > 1e-9) {
            const sp = vmax * Math.tanh(gain * m / vmax);
            tx = wx / m * sp;
            ty = wy / m * sp;
        }
        const a = 1 - Math.exp(-dt / WAVE_PUSH_TAU);
        o._wtx = (o._wtx ?? 0) + (tx - (o._wtx ?? 0)) * a;
        o._wty = (o._wty ?? 0) + (ty - (o._wty ?? 0)) * a;
        return [o._wtx, o._wty];
    }

    // Sóng quanh mép một lá sen: biên độ lớn nhất + hướng nước ập vào.
    // (mặt lá sen chặn sóng nên chỉ đo được ở ngay ngoài mép)
    waveRing(cx, cy, rad) {
        if (this.waveEnergy < WAVE_REST)
            return [0, 0, 0];
        let best = 0, bx = 0, by = 0;
        for (let k = 0; k < 8; k++) {
            const a = k * TAU / 8;
            const ca = Math.cos(a), sa = Math.sin(a);
            const v = this.waveAt(cx + ca * rad, cy + sa * rad);
            const m = Math.abs(v);
            if (m > best) {
                best = m;
                // nước cao ở phía (ca, sa) thì lá bị đẩy về phía ngược lại
                const sg = v >= 0 ? 1 : -1;
                bx = -ca * sg;
                by = -sa * sg;
            }
        }
        return [best, bx, by];
    }

    // Một giọt nước rơi từ trên xuống; khi chạm mặt nước mới toé sóng
    _spawnDrop(x, y, amp) {
        const z = rand(25, 45) * this.u;
        this.fallingDrops.push({x, y, z, z0: z, vz: 0, amp, done: false});
    }

    // "Sự kiện nước động" cho cá giật mình (không tự tạo sóng)
    stir(x, y, amp, src = null) {
        this.ripples.push({x, y, age: 0, amp, src});
        if (this.ripples.length > 40)
            this.ripples.shift();
    }

    // Một giọt/click: cá giật mình và tạo sóng thật trên lưới
    // src = con cá gây ra sóng (để nó không giật mình vì chính mình)
    drop(x, y, amp = 1, src = null) {
        this.stir(x, y, amp, src);
        if (this.waveEnergy < WAVE_REST)
            this._rasterObstacles();   // đang ngủ thì mask đã cũ; đang chạy thì _stepWaves vừa dựng
        this._injectDrop(x, y, amp);
    }

    // Kéo chuột trên mặt nước: một loạt điểm sóng nhỏ dọc đường kéo.
    // points = [[x, y], ...] trong toạ độ ao.
    wake(points, amp) {
        if (!points.length)
            return;
        if (this.waveEnergy < WAVE_REST)
            this._rasterObstacles();
        for (const [x, y] of points)
            this._injectDrop(x, y, amp);
    }

    // Bất kỳ vật nổi nào di chuyển trên mặt nước đều rẽ nước: rải gợn hai bên
    // đường đi của vật (như đuôi thuyền). Gợn mạnh hay nhẹ theo TỐC ĐỘ của vật.
    // obj cần có _wakeX/_wakeY (mốc lần rải trước), rad = bán kính vật.
    wakeTrail(obj, rad) {
        if (obj._wakeX === undefined) {
            obj._wakeX = obj.x;
            obj._wakeY = obj.y;
            return;
        }
        const dx = obj.x - obj._wakeX, dy = obj.y - obj._wakeY;
        const d = Math.hypot(dx, dy);
        const step = 8;
        // trôi chậm theo dòng nước thì không rẽ nước, để mặt nước được "ngủ" (tiết kiệm CPU)
        if (Math.hypot(obj.vx, obj.vy) < 18 * this.u) {
            obj._wakeX = obj.x;
            obj._wakeY = obj.y;
            return;
        }
        if (d < step)
            return;
        const n = Math.min(6, Math.floor(d / step));
        const ux = dx / d, uy = dy / d;
        const px = -uy, py = ux;      // pháp tuyến của hướng đi
        const R = rad * 1.03 + 1;
        const sp = Math.hypot(obj.vx, obj.vy);            // tốc độ (px ao/giây)
        const amp = clamp(0.025 + sp / 1500, 0.025, 0.15);
        const pts = [];
        for (let i = 1; i <= n; i++) {
            const cx = obj._wakeX + ux * step * i;
            const cy = obj._wakeY + uy * step * i;
            pts.push([cx + px * R, cy + py * R], [cx - px * R, cy - py * R]);
        }
        this.wake(pts, amp);
        obj._wakeX += ux * step * n;
        obj._wakeY += uy * step * n;
    }

    // ── Kéo vật nổi bằng chuột ──
    // Tìm vật nằm dưới điểm (x, y): lá sen trước, rồi lá rụng đang trôi.
    pick(x, y) {
        const u = this.u;
        let best = null, bestD = Infinity;
        for (const p of this.pads) {
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < p.r * 0.95 && d < bestD) {
                best = p;
                bestD = d;
            }
        }
        if (best)
            return best;

        for (const l of this.leaves) {
            if (l.state !== 'water')
                continue;
            const [ax, ay, bx, by] = l.capsule();
            const [px, py] = closestPointOnSeg(x, y, ax, ay, bx, by);
            if (Math.hypot(px - x, py - y) < l.rad + 2 * u)
                return l;
        }
        return null;
    }

    // Bắt đầu kéo vật tại điểm bấm (px, py) của ao; giữ đúng khoảng lệch so với con trỏ
    beginGrab(obj, px, py) {
        this.grab = {obj, ox: obj.x - px, oy: obj.y - py, x: obj.x, y: obj.y};
        obj._wakeX = obj.x;
        obj._wakeY = obj.y;
    }

    // Con trỏ đi tới (px, py) của ao
    moveGrab(px, py) {
        if (!this.grab)
            return;
        this.grab.x = px + this.grab.ox;
        this.grab.y = py + this.grab.oy;
    }

    endGrab() {
        this.grab = null;
    }

    // Mức chuyển động của vật nổi và sóng, 0..1 (để chọn FPS)
    activity() {
        const ref = ACTIVE_SPEED * this.u;
        let sp = 0;
        for (const p of this.pads)
            sp = Math.max(sp, Math.hypot(p.vx, p.vy));
        for (const l of this.leaves)
            sp = Math.max(sp, Math.hypot(l.vx, l.vy));
        let a = sp / ref;
        if (this.grab || this.fallingDrops.length)
            a = 1;
        else if (this.waveEnergy >= WAVE_REST)
            a = Math.max(a, 0.5);   // sóng đang lan: ít nhất ~32 FPS
        return a;
    }

    update(dt) {
        dt = Math.min(dt, 0.1);
        this.t += dt;

        for (const r of this.ripples)
            r.age += dt;
        this.ripples = this.ripples.filter(r => r.age < RIPPLE_LIFE);

        if (AMBIENT_DROPS) {
            this.nextDrop -= dt;
            if (this.nextDrop <= 0) {
                this.nextDrop = rand(2, 6);
                this._spawnDrop(rand(0, this.w), rand(0, this.h), 0.35);
            }
        }

        // giọt mưa đang rơi: chạm mặt nước mới toé sóng
        if (this.fallingDrops.length) {
            for (const d of this.fallingDrops) {
                d.vz += 220 * this.u * dt;
                d.z -= d.vz * dt;
                if (d.z <= 0) {
                    d.done = true;
                    this.drop(d.x, d.y, d.amp);
                }
            }
            this.fallingDrops = this.fallingDrops.filter(d => !d.done);
        }

        // thỉnh thoảng một lá mới rụng xuống (1-5 phút một lần)
        this._spawnT -= dt;
        if (this._spawnT <= 0) {
            this._spawnT = rand(LEAF_SPAWN_MIN, LEAF_SPAWN_MAX);
            // lá đã chìm / nằm dưới đáy không tính vào giới hạn lá trên mặt nước
            let floating = 0;
            for (const l of this.leaves) {
                if (l.state !== 'sink' && l.state !== 'bed')
                    floating++;
            }
            let room = floating < LEAF_COUNT + LEAF_EXTRA;
            if (!room)
                room = this._sinkOldest();   // ao đã đầy: lá trôi lâu nhất ngấm nước, nhường chỗ
            if (room) {
                const leaf = new Leaf(this);
                leaf.startFall();
                this.leaves.push(leaf);
            }
        }

        this._stepWaves(dt);

        for (const f of this.fish) f.update(dt);
        this._resolveFish();
        for (const p of this.pads) p.update(dt);
        for (const l of this.leaves) l.update(dt);

        // va chạm sau khi mọi vật đã di chuyển: không vật nổi nào đè lên nhau
        this._resolveFloating();

        // đáy đầy: lá nằm lâu nhất mờ dần rồi biến mất
        let bed = 0, oldest = null;
        for (const l of this.leaves) {
            if (l.state === 'bed' && !l.retire) {
                bed++;
                if (!oldest)
                    oldest = l;
            }
        }
        if (bed > LEAF_BED_MAX && oldest)
            oldest.retire = true;

        // lá bị dọn khỏi đáy thì bỏ khỏi ao
        if (this.leaves.some(l => l.dead))
            this.leaves = this.leaves.filter(l => !l.dead);
    }

    draw(cr) {
        const {w, h, u, t} = this;

        // pixel art: tắt khử răng cưa
        cr.setAntialias(Cairo.Antialias.NONE);

        // đáy bể + nước (cache)
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceSurface(this._bg, 0, 0);
        cr.paintWithAlpha(WATER_OPACITY);
        cr.setOperator(Cairo.Operator.OVER);

        // vệt nắng lung linh dưới đáy
        for (let i = 0; i < 14; i++) {
            const ph = i * 2.399;
            const cx = (((i * 0.618 + Math.sin(t * 0.05 + ph) * 0.08) % 1) + 1) % 1 * w;
            const cy = (((i * 1.184 + Math.cos(t * 0.04 + ph) * 0.08) % 1) + 1) % 1 * h;
            const s = (16 + Math.sin(t * 0.9 + ph) * 5) * u;
            cr.save();
            cr.translate(cx, cy);
            cr.scale(s, s * 0.6);
            cr.newPath();
            cr.arc(0, 0, 1, 0, TAU);
            cr.restore();
            cr.setSourceRGBA(0.8, 1, 0.95, 0.045 + 0.02 * Math.sin(t * 1.3 + ph));
            cr.fill();
        }

        // rong dưới đáy
        for (const wd of this.weeds) wd.draw(cr);

        // chia lá theo tầng: lá đang chìm nằm dưới nước, lá trên mặt nước, lá đang rơi/đậu trên lá sen
        const wet = this._wet, dry = this._dry, sunk = this._sink;
        wet.length = 0;
        dry.length = 0;
        sunk.length = 0;
        for (const l of this.leaves) {
            if (l.state === 'sink' || l.state === 'bed')
                sunk.push(l);
            else if (l.state === 'water')
                wet.push(l);
            else
                dry.push(l);
        }

        // lá đang chìm dưới mặt nước (cá sẽ bơi đè lên)
        for (const l of sunk) l.draw(cr, false);

        // cá (bóng rồi thân), lá sen phủ lên trên
        // con ở sâu vẽ trước, con ở cao vẽ đè lên
        const fishByZ = [...this.fish].sort((a, b) => a.zBase - b.zBase);
        for (const f of fishByZ) f.draw(cr, true);
        for (const f of fishByZ) f.draw(cr, false);

        // sóng nằm trên mặt nước (phủ lên cá) nhưng dưới lá sen và lá rụng
        this._drawWaves(cr);
        this._drawGlare(cr);

        // Lá rụng trôi trên mặt nước vẽ trước (nằm dưới mép lá sen),
        // lá đang đậu TRÊN lá sen và lá đang rơi vẽ sau cùng.
        for (const l of wet) l.draw(cr, true);
        for (const l of wet) l.draw(cr, false);
        for (const p of this.pads) p.draw(cr, true);
        for (const p of this.pads) p.draw(cr, false);
        for (const l of dry) l.draw(cr, true);
        for (const l of dry) l.draw(cr, false);

        // giọt mưa đang rơi (cho thấy rõ nguyên nhân của gợn sóng)
        for (const d of this.fallingDrops) {
            const k = clamp(d.z / Math.max(1e-6, d.z0), 0, 1);
            const dx = Math.round(d.x), dy = Math.round(d.y - d.z * 0.6);
            cr.newPath();
            cr.rectangle(dx, dy - 2, 1, 3);       // vệt nước
            cr.rectangle(dx + 1, dy, 1, 1);       // giọt
            cr.setSourceRGBA(0.78, 0.90, 1.0, 0.30 + 0.55 * (1 - k));
            cr.fill();
            cr.newPath();
            cr.rectangle(Math.round(d.x), Math.round(d.y), 1, 1);   // bóng mờ chỗ sắp rơi
            cr.setSourceRGBA(0, 0.05, 0.10, 0.08 + 0.16 * (1 - k));
            cr.fill();
        }

        // màu theo giờ: nhân cả cảnh với màu môi trường (tối về đêm, ám cam lúc chiều tà)
        const amb = this.light.amb;
        if (amb[0] < 0.995 || amb[1] < 0.995 || amb[2] < 0.995) {
            if (Cairo.Operator.MULTIPLY !== undefined) {
                cr.setOperator(Cairo.Operator.MULTIPLY);
                cr.setSourceRGBA(amb[0], amb[1], amb[2], 1);
            } else {
                cr.setSourceRGBA(0, 0.02, 0.08, 1 - (amb[0] + amb[1] + amb[2]) / 3);
            }
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
        }

        // lấp lánh vẽ sau cùng để không bị tối theo màu môi trường
        this._drawGlitter(cr);
        if (CELESTIAL && CELESTIAL_ON_TOP) {
            // mặt trời / mặt trăng chỉ là bóng trên mặt nước: vẽ sáng rõ, nhưng lá sen và lá rụng
            // (trên mặt nước, trên lá sen, đang rơi) phải che lên nó => khoét đúng hình các lá ra khỏi lớp này
            cr.pushGroup();
            if (this._drawCelestial(cr)) {
                cr.setOperator(Cairo.Operator.DEST_OUT);
                for (const pd of this.pads) pd.draw(cr, 'mask');
                for (const l of wet) l.draw(cr, 'mask');
                for (const l of dry) l.draw(cr, 'mask');
                cr.setOperator(Cairo.Operator.OVER);
            }
            cr.popGroupToSource();
            cr.paint();
        }

        // tối nhẹ ở góc cho có chiều sâu (cache)
        cr.setSourceSurface(this._vig, 0, 0);
        cr.paint();
    }
}

// ───────────── Mỗi màn hình một ao ─────────────
class PondView {
    constructor(monitor, index, snap = null) {
        this.index = index;
        this.monitor = monitor;
        this.scale = 1 / PIXEL_SIZE;
        const w = Math.max(1, Math.round(monitor.width * this.scale));
        const h = Math.max(1, Math.round(monitor.height * this.scale));
        this.pond = new Pond(w, h, (LAYOUT_SEED + index * 7919) >>> 0, snap);

        this.area = new St.DrawingArea({
            x: monitor.x,
            y: monitor.y,
            width: w,
            height: h,
            reactive: false,
        });
        this.area.set_scale(PIXEL_SIZE, PIXEL_SIZE);
        try {
            this.area.set_content_scaling_filters(
                Clutter.ScalingFilter.NEAREST, Clutter.ScalingFilter.NEAREST);
        } catch (e) {
            logError(e, 'koipond scaling filter (area)');
        }
        this.area.connect('repaint', a => {
            const cr = a.get_context();
            try {
                this.pond.draw(cr);
            } finally {
                cr.$dispose();
            }
        });

        this.clones = new Set();
    }

    makeClone() {
        const clone = new Clutter.Clone({
            source: this.area,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            reactive: false,
        });
        try {
            clone.set_content_scaling_filters(
                Clutter.ScalingFilter.NEAREST, Clutter.ScalingFilter.NEAREST);
        } catch (e) {
            logError(e, 'koipond scaling filter (clone)');
        }
        this.clones.add(clone);
        clone.connect('destroy', () => this.clones.delete(clone));
        return clone;
    }

    // Toạ độ trên ao [x, y] nếu điểm (x, y) của màn hình nằm trong ao này, không thì null
    toPond(x, y, overview) {
        if (overview) {
            for (const c of this.clones) {
                if (!c.mapped)
                    continue;
                const [cx, cy] = c.get_transformed_position();
                const [cw, ch] = c.get_transformed_size();
                if (cw > 0 && ch > 0 && x >= cx && y >= cy && x <= cx + cw && y <= cy + ch)
                    return [(x - cx) / cw * this.pond.w, (y - cy) / ch * this.pond.h];
            }
            return null;
        }

        const m = this.monitor;
        if (x >= m.x && y >= m.y && x < m.x + m.width && y < m.y + m.height)
            return [(x - m.x) * this.scale, (y - m.y) * this.scale];
        return null;
    }

    destroy() {
        for (const c of [...this.clones])
            c.destroy();
        this.clones.clear();
        this.area.destroy();
    }
}

// ───────────── Extension ─────────────
export default class KoiPondExtension extends Extension {
    enable() {
        ASSET_DIR = this.path;
        this._inj = new InjectionManager();
        this._views = [];
        this._signals = [];       // [actor, id]
        this._failed = false;
        this._press = null;       // đang giữ chuột (chưa biết click hay kéo)
        this._drag = null;        // đang giữ chuột để kéo sóng
        this._t0 = GLib.get_monotonic_time();

        // cài đặt từ hộp Cài đặt của extension (nếu schema chưa biên dịch thì dùng giá trị mặc định)
        this._settings = null;
        this._settingsId = 0;
        this._settingsTimer = 0;
        this._pendingKeys = new Set();
        try {
            this._settings = this.getSettings(SCHEMA_ID);
            applySettings(this._settings);
            this._ensureSeed();
            this._settingsId = this._settings.connect('changed',
                (_s, key) => this._onSettingChanged(key));
        } catch (e) {
            logError(e, 'koipond settings (dùng giá trị mặc định)');
        }

        this._buildViews();
        this._hookOverview();

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());
        this._captureId = global.stage.connect('captured-event',
            (a, e) => this._onCapturedEvent(a, e));

        this._last = GLib.get_monotonic_time();
        this._startTimer();
    }

    // Vòng lặp chính (chạy lại khi FPS tối đa đổi)
    _startTimer() {
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / FPS_MAX), () => {
            try {
                this._tick();
            } catch (e) {
                if (!this._failed) {
                    this._failed = true;
                    logError(e, 'koipond tick');
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ── Cài đặt: gom các thay đổi liên tiếp (kéo thanh số...) rồi áp một lần ──
    _onSettingChanged(key) {
        this._pendingKeys.add(key);
        if (this._settingsTimer)
            return;
        this._settingsTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._settingsTimer = 0;
            try {
                this._applyPendingSettings();
            } catch (e) {
                logError(e, 'koipond apply settings');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Lần chạy đầu (seed = 0): chọn ngẫu nhiên một seed rồi lưu lại, các lần sau dùng đúng seed đó
    _ensureSeed() {
        if (LAYOUT_SEED > 0 || !this._settings)
            return;
        LAYOUT_SEED = 1 + Math.floor(Math.random() * 999999);
        this._settings.set_int('layout-seed', LAYOUT_SEED);
    }

    _applyPendingSettings() {
        const keys = [...this._pendingKeys];
        this._pendingKeys.clear();
        if (!this._settings || !this._views)
            return;
        applySettings(this._settings);
        this._ensureSeed();
        // số lượng / độ phân giải / bộ nhớ đệm đổi => dựng lại ao; còn lại có hiệu lực ngay
        if (keys.some(k => SETTING_ROWS.get(k)?.structural))
            this._rebuild(!keys.includes('layout-seed'));   // đổi seed = muốn bố cục mới, không giữ trạng thái cũ
        if (keys.includes('fps-max'))
            this._startTimer();
    }

    disable() {
        this._press = null;
        this._endDrag();
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsTimer) {
            GLib.Source.remove(this._settingsTimer);
            this._settingsTimer = 0;
        }
        if (this._settings && this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._settings = null;
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = 0;
        }
        this._inj?.clear();
        this._inj = null;
        _imgCache.clear();
        _frameCache.clear();
        _fishDefCache.clear();
        FISH_ROSTER = [];
        this._destroyViews();
        this._views = null;
    }

    // ── dựng / dọn ──
    _buildViews(snaps = null) {
        const group = Main.layoutManager._backgroundGroup;
        Main.layoutManager.monitors.forEach((monitor, i) => {
            const view = new PondView(monitor, i, snaps?.[i] ?? null);
            group.add_child(view.area);
            this._keepOnTop(group, view.area);
            view.pond.setHour(this._clockHour());
            this._views.push(view);
        });
    }

    _destroyViews() {
        this._press = null;
        this._endDrag();
        for (const [actor, id] of this._signals) {
            try { actor.disconnect(id); } catch (_e) { /* actor đã bị huỷ */ }
        }
        this._signals = [];
        for (const v of this._views ?? [])
            v.destroy();
        if (this._views)
            this._views.length = 0;
    }

    // keep = true: chụp trạng thái bể cũ rồi áp lại vào bể mới (đổi cài đặt không làm bể xáo trộn)
    _rebuild(keep = true) {
        let snaps = null;
        if (keep) {
            snaps = (this._views ?? []).map(v => {
                try {
                    return v.pond.snapshot();
                } catch (e) {
                    logError(e, 'koipond snapshot');
                    return null;
                }
            });
        }
        this._destroyViews();
        this._buildViews(snaps);
        this._attachToExistingBackgrounds();
    }

    // Hình nền mới (đổi wallpaper...) có thể được thêm lên trên ao => đẩy ao lên lại
    _keepOnTop(container, actor) {
        const id = container.connect('child-added', (_c, child) => {
            if (child === actor)
                return;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    if (actor.get_parent() === container)
                        container.set_child_above_sibling(actor, null);
                } catch (_e) { /* đã huỷ */ }
                return GLib.SOURCE_REMOVE;
            });
        });
        this._signals.push([container, id]);
    }

    // ── Overview ──
    _hookOverview() {
        const WB = Workspace.WorkspaceBackground;
        if (!WB) {
            log('koipond: Workspace.WorkspaceBackground không có, Overview sẽ không có ao');
            return;
        }
        const self = this;
        this._inj.overrideMethod(WB.prototype, '_init', original => {
            return function (...args) {
                original.apply(this, args);
                try {
                    self._attachClone(this);
                } catch (e) {
                    logError(e, 'koipond attachClone');
                }
            };
        });
        this._attachToExistingBackgrounds();
    }

    _attachToExistingBackgrounds() {
        const WB = Workspace.WorkspaceBackground;
        if (!WB)
            return;
        const found = [];
        const walk = actor => {
            if (actor instanceof WB) {
                found.push(actor);
                return;
            }
            for (const c of actor.get_children())
                walk(c);
        };
        walk(Main.layoutManager.overviewGroup);
        for (const bg of found) {
            try {
                this._attachClone(bg);
            } catch (e) {
                logError(e, 'koipond attachExisting');
            }
        }
    }

    _attachClone(bg) {
        const view = this._views?.find(v => v.index === bg._monitorIndex);
        if (!view)
            return;
        const container = bg._backgroundGroup ?? bg;
        const clone = view.makeClone();
        // ép clone luôn có kích thước đúng bằng nền chứa nó
        clone.add_constraint(new Clutter.BindConstraint({
            source: container,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));
        container.add_child(clone);
        this._keepOnTop(container, clone);
    }

    // ── Chuột: click (nhả nhanh, gần như không di chuyển) tạo một gợn;
    //          giữ chuột kéo tạo vệt sóng dài, không tạo gợn click ──
    _onCapturedEvent(_actor, event) {
        const type = event.type();

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const press = this._press;
            this._press = null;
            this._endDrag();
            // chỉ tính là click khi nhả nhanh và gần như không di chuyển
            if (press && !press.dragging &&
                (GLib.get_monotonic_time() - press.t) / 1000 <= CLICK_MS) {
                const [ux, uy] = event.get_coords();
                if (Math.hypot(ux - press.sx, uy - press.sy) <= CLICK_MOVE)
                    press.view.pond.drop(press.x, press.y);
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.MOTION) {
            const press = this._press;
            if (!press)
                return Clutter.EVENT_PROPAGATE;

            // phòng khi không nhận được sự kiện nhả chuột: đã buông thì bỏ
            if (Clutter.ModifierType.BUTTON1_MASK !== undefined &&
                !(event.get_state() & Clutter.ModifierType.BUTTON1_MASK)) {
                this._press = null;
                this._endDrag();
                return Clutter.EVENT_PROPAGATE;
            }

            if (this._drag) {
                this._dragTo(event);
                return Clutter.EVENT_PROPAGATE;
            }

            // di chuyển đủ xa => thành thao tác kéo, không còn là click
            const [mx, my] = event.get_coords();
            if (Math.hypot(mx - press.sx, my - press.sy) > CLICK_MOVE) {
                press.dragging = true;
                if (press.grab) {
                    // kéo lá sen / lá rụng
                    press.view.pond.beginGrab(press.grab, press.x, press.y);
                    this._drag = {view: press.view, x: press.x, y: press.y,
                        grab: true, lastStir: 0};
                    this._dragTo(event);
                } else if (DRAG_WAKE > 0) {
                    // kéo trên nước trống: tạo vệt sóng
                    this._drag = {view: press.view, x: press.x, y: press.y};
                    this._dragTo(event);
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (type !== Clutter.EventType.BUTTON_PRESS ||
            event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const overview = Main.overview.visible;

        // actor thật sự nằm dưới con trỏ (chỉ tính actor nhận được chuột)
        const hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        const src = event.get_source();

        if (DEBUG_CLICK)
            log(`koipond press overview=${overview} src=${src} hit=${hit}`);

        if (overview) {
            // bấm trúng cửa sổ thu nhỏ thì bỏ qua, chỉ nhận khi bấm vào phần nền ao
            for (let a = hit ?? src; a; a = a.get_parent()) {
                if (a instanceof WindowPreview.WindowPreview)
                    return Clutter.EVENT_PROPAGATE;
            }
        } else {
            // chỉ nhận khi bấm đúng vào nền desktop (không phải cửa sổ/panel/widget)
            const bgGroup = Main.layoutManager._backgroundGroup;
            if (!this._isUnder(hit, bgGroup) && !this._isUnder(src, bgGroup))
                return Clutter.EVENT_PROPAGATE;
        }

        // nhớ chỗ bấm; gợn sóng chỉ được tạo lúc NHẢ chuột nếu đúng là click
        const at = this._pondAt(x, y, overview);
        if (at) {
            this._press = {
                view: at.view,
                x: at.x,
                y: at.y,
                sx: x,
                sy: y,
                t: GLib.get_monotonic_time(),
                dragging: false,
                grab: at.view.pond.pick(at.x, at.y),
            };
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _pondAt(x, y, overview) {
        for (const v of this._views) {
            const p = v.toPond(x, y, overview);
            if (p)
                return {view: v, x: p[0], y: p[1]};
        }
        return null;
    }

    // Giữ chuột trái và kéo: kéo vật nổi nếu bấm trúng, không thì rải sóng dọc đường kéo
    _dragTo(event) {
        const drag = this._drag;
        const [x, y] = event.get_coords();
        const overview = Main.overview.visible;
        const p = drag.view.toPond(x, y, overview);

        // đang kéo một vật (lá sen / lá rụng)
        if (drag.grab) {
            if (!p)
                return;   // ra khỏi ao thì giữ vật ở chỗ cũ
            drag.view.pond.moveGrab(p[0], p[1]);
            // thỉnh thoảng làm cá giật mình theo vật bị kéo
            const now = GLib.get_monotonic_time();
            if (now - drag.lastStir > 150000) {
                drag.lastStir = now;
                drag.view.pond.stir(p[0], p[1], 0.2);
            }
            return;
        }

        let pt = p;

        // kéo sang màn hình khác
        if (!pt) {
            const at = this._pondAt(x, y, overview);
            if (!at)
                return;
            drag.view = at.view;
            drag.x = at.x;
            drag.y = at.y;
            return;
        }

        const dx = pt[0] - drag.x, dy = pt[1] - drag.y;
        const dist = Math.hypot(dx, dy);
        if (dist < DRAG_SPACING)
            return;

        const n = Math.min(DRAG_MAX, Math.floor(dist / DRAG_SPACING));
        const ux = dx / dist, uy = dy / dist;
        const pts = [];
        for (let i = 1; i <= n; i++)
            pts.push([drag.x + ux * DRAG_SPACING * i, drag.y + uy * DRAG_SPACING * i]);

        drag.view.pond.wake(pts, DRAG_WAKE);
        const last = pts[pts.length - 1];
        drag.view.pond.stir(last[0], last[1], 0.22);   // cá giật mình theo vệt kéo
        drag.x = last[0];
        drag.y = last[1];
    }

    // Kết thúc kéo: thả vật đang giữ (vật trôi tiếp theo quán tính)
    _endDrag() {
        const d = this._drag;
        if (d && d.grab)
            d.view.pond.endGrab();
        this._drag = null;
    }

    _isUnder(actor, root) {
        for (let a = actor; a; a = a.get_parent()) {
            if (a === root)
                return true;
        }
        return false;
    }

    // Giờ hiện tại (0..24, có phần lẻ). TIME_OVERRIDE / TIME_SPEED để xem thử các buổi trong ngày.
    _clockHour() {
        if (TIME_OVERRIDE !== null)
            return TIME_OVERRIDE;
        const d = GLib.DateTime.new_now_local();
        const real = d.get_hour() + d.get_minute() / 60 + d.get_second() / 3600;
        if (TIME_SPEED === 1)
            return real;
        const elapsed = (GLib.get_monotonic_time() - this._t0) / 1e6;
        return (real + elapsed * TIME_SPEED / 3600) % 24;
    }

    // ── Vòng lặp ──
    _tick() {
        const now = GLib.get_monotonic_time();
        // FPS tự động: chậm => FPS_MIN, nhanh / đang kéo => FPS_MAX (tăng ngay, giảm từ từ cho đỡ giật)
        const target = this._targetFps();
        this._fps = target > (this._fps ?? FPS_MIN)
            ? target
            : (this._fps ?? FPS_MIN) + (target - (this._fps ?? FPS_MIN)) * 0.03;
        const need = 1 / this._fps;
        const slack = 0.5 / FPS_MAX;
        const dt = (now - this._last) / 1e6;
        if (dt < need - slack)
            return;
        this._last = now;

        if (Main.sessionMode.isLocked)
            return;

        const hour = this._clockHour();
        for (const v of this._views) {
            if (!Main.overview.visible && this._isCovered(v.index))
                continue;
            v.pond.setHour(hour);
            // Bước mô phỏng CỐ ĐỊNH (PHYS_DT): FPS vẽ cao hay thấp thì vật lý, va chạm và sóng
            // vẫn chạy y hệt nhau, chỉ khác số lần vẽ. Phần dư được giữ lại cho lần sau.
            v._acc = Math.min((v._acc ?? 0) + dt, 0.25);
            while (v._acc >= PHYS_DT) {
                v.pond.update(PHYS_DT);
                v._acc -= PHYS_DT;
            }
            v.area.queue_repaint();
        }
    }

    // FPS mong muốn theo mức độ chuyển động hiện tại (0 = yên, 1 = rất nhanh)
    _targetFps() {
        if (this._drag || this._press?.dragging)
            return FPS_MAX;
        let a = 0;
        for (const v of this._views)
            a = Math.max(a, v.pond.activity());
        return FPS_MIN + (FPS_MAX - FPS_MIN) * Math.min(1, a);
    }

    _isCovered(monitorIndex) {
        const ws = global.workspace_manager.get_active_workspace();
        for (const actor of global.get_window_actors()) {
            const w = actor.meta_window;
            if (!w || w.minimized || w.get_monitor() !== monitorIndex)
                continue;
            if (w.window_type !== Meta.WindowType.NORMAL || !w.located_on_workspace(ws))
                continue;
            if (w.is_fullscreen())
                return true;
            const maxed = typeof w.is_maximized === 'function'
                ? w.is_maximized()
                : w.get_maximized() === Meta.MaximizeFlags.BOTH;
            if (maxed)
                return true;
        }
        return false;
    }
}
