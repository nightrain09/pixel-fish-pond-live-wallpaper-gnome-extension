// Koi Pond Wallpaper: quét thư mục fish/ (dùng chung cho extension.js và prefs.js, không phụ thuộc Cairo).
//
// Cấu trúc:
//   fish/<loài>/<tên>.png    ảnh cá nhìn từ trên xuống => ảnh được uốn theo xương sống của cá
//   fish/<loài>/<tên>.json   thông số khung xương => cá vẽ bằng code theo thông số đó
//   fish/<loài>/<tên>.png + <tên>.json cùng tên => ảnh PNG, JSON là tuỳ chọn đi kèm (độ dài, hướng đầu...)
// File đặt thẳng trong fish/ (không có thư mục loài) cũng được.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const FISH_DIR = 'fish';

const natural = (a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});

function listDir(dir) {
    const out = [];
    let en = null;
    try {
        en = dir.enumerate_children('standard::name,standard::type,time::modified',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            out.push({
                name: info.get_name(),
                isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                mtime: info.get_attribute_uint64('time::modified'),
            });
        }
    } catch (_e) {
        /* thư mục chưa có */
    } finally {
        try { en?.close(null); } catch (_e) { /* đã đóng */ }
    }
    return out;
}

// Trả về mảng {id, species, name, png, json, sig}, sắp xếp theo loài rồi theo tên (số tự nhiên: koi2 trước koi10).
// id = 'koi/koi1' (hoặc 'koi1' nếu nằm thẳng trong fish/); sig đổi khi file được sửa.
export function scanFishDir(baseDir) {
    const root = Gio.File.new_for_path(baseDir);
    const groups = new Map();      // id => entry

    const addFiles = (species, dirPath, files) => {
        for (const f of files) {
            if (f.isDir || f.name.startsWith('.'))
                continue;
            const m = /^(.+)\.(png|json)$/i.exec(f.name);
            if (!m)
                continue;
            const id = species ? `${species}/${m[1]}` : m[1];
            let e = groups.get(id);
            if (!e) {
                e = {id, species, name: m[1], png: null, json: null, sig: ''};
                groups.set(id, e);
            }
            const p = GLib.build_filenamev([dirPath, f.name]);
            if (m[2].toLowerCase() === 'png')
                e.png = p;
            else
                e.json = p;
            e.sig += `${f.name}:${f.mtime};`;
        }
    };

    addFiles('', baseDir, listDir(root));
    for (const d of listDir(root)) {
        if (!d.isDir || d.name.startsWith('.'))
            continue;
        const dp = GLib.build_filenamev([baseDir, d.name]);
        addFiles(d.name, dp, listDir(Gio.File.new_for_path(dp)));
    }

    return [...groups.values()].sort((a, b) =>
        natural(a.species, b.species) || natural(a.name, b.name));
}

// Chuỗi JSON {"koi/koi1": 2, ...} => object. File chưa có trong đó mặc định 1 con.
export function parseCounts(str) {
    try {
        const o = JSON.parse(str || '{}');
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (_e) {
        return {};
    }
}

export const DEFAULT_COUNT = 1;
export const MAX_PER_FILE = 30;
