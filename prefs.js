// Koi Pond Wallpaper: Preferences window (GNOME Shell 45-49)
// The UI is built automatically from settings-spec.js.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SCHEMA_ID, SPEC} from './settings-spec.js';
import {FISH_DIR, scanFishDir, parseCounts, DEFAULT_COUNT, MAX_PER_FILE} from './fish-files.js';

export default class KoiPondPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_ID);
        window._koiSettings = settings;   // keep a reference until the window closes
        window.set_default_size(760, 780);

        for (const g of SPEC) {
            const page = new Adw.PreferencesPage({
                title: g.title,
                icon_name: g.icon ?? 'preferences-system-symbolic',
            });

            const group = new Adw.PreferencesGroup({
                title: g.title,
                description: g.desc ?? '',
            });
            const rows = new Map();
            for (const r of g.rows) {
                if (r.hidden)
                    continue;
                const row = this._makeRow(settings, r);
                rows.set(r.key, row);
                group.add(row);
            }
            // rows that depend on a switch are greyed out while it is off
            for (const r of g.rows) {
                if (r.dependsOn && !r.hidden)
                    settings.bind(r.dependsOn, rows.get(r.key), 'sensitive', Gio.SettingsBindFlags.GET);
            }
            if (g.id === 'scene') {
                const rollRow = new Adw.ActionRow({
                    title: 'New random layout',
                    subtitle: 'Pick a new seed; the pond is rebuilt once with a different arrangement',
                });
                const rollBtn = new Gtk.Button({label: 'Roll', valign: Gtk.Align.CENTER});
                rollBtn.connect('clicked', () =>
                    settings.set_int('layout-seed', 1 + Math.floor(Math.random() * 999999)));
                rollRow.add_suffix(rollBtn);
                group.add(rollRow);
            }
            page.add(group);
            if (g.id === 'fish')
                page.add(this._makeCustomFishGroup(settings));

            const resetGroup = new Adw.PreferencesGroup();
            const btn = new Gtk.Button({
                label: 'Reset this page to defaults',
                halign: Gtk.Align.START,
            });
            btn.connect('clicked', () => {
                for (const r of g.rows) {
                    if (r.key !== 'layout-seed')   // giữ nguyên bố cục hiện tại
                        settings.reset(r.key);
                }
            });
            resetGroup.add(btn);
            page.add(resetGroup);

            window.add(page);
        }
    }

    // Danh sách file trong fish/ kèm ô số lượng cho từng file (ví dụ 2 con ca-chep/cachep1)
    _makeCustomFishGroup(settings) {
        const dir = GLib.build_filenamev([this.path, FISH_DIR]);
        const group = new Adw.PreferencesGroup({
            title: 'Custom fish files',
            description: 'Put .png (top-down picture, head to the right) or .json (skeleton parameters) files ' +
                'into fish/<species>/ next to the extension, for example fish/koi/koi1.png. ' +
                'Set how many of each file swim in the pond; 0 = skip it.',
        });

        const actions = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 6});
        const rescan = new Gtk.Button({label: 'Rescan', valign: Gtk.Align.CENTER});
        const open = new Gtk.Button({label: 'Open folder', valign: Gtk.Align.CENTER});
        actions.append(rescan);
        actions.append(open);
        group.set_header_suffix(actions);

        let rows = [];
        const refill = () => {
            for (const r of rows)
                group.remove(r);
            rows = [];
            let entries = [];
            try {
                entries = scanFishDir(dir);
            } catch (e) {
                logError(e, 'koipond scan fish/');
            }
            if (!entries.length) {
                const empty = new Adw.ActionRow({
                    title: 'No fish files found',
                    subtitle: `Add files to ${dir}, then press Rescan`,
                });
                group.add(empty);
                rows.push(empty);
            }
            for (const e of entries) {
                const kind = e.png ? 'PNG picture bent along the skeleton' : 'JSON skeleton, drawn by code';
                const counts = parseCounts(settings.get_string('fish-custom-counts'));
                const adj = new Gtk.Adjustment({
                    lower: 0, upper: MAX_PER_FILE, step_increment: 1, page_increment: 5,
                    value: Math.max(0, Math.min(MAX_PER_FILE, counts[e.id] ?? DEFAULT_COUNT)),
                });
                const row = new Adw.SpinRow({title: e.id, subtitle: kind, adjustment: adj, digits: 0});
                row.connect('notify::value', () => {
                    const cur = parseCounts(settings.get_string('fish-custom-counts'));
                    cur[e.id] = Math.round(row.value);
                    settings.set_string('fish-custom-counts', JSON.stringify(cur));
                });
                settings.bind('fish-use-custom', row, 'sensitive', Gio.SettingsBindFlags.GET);
                group.add(row);
                rows.push(row);
            }
        };
        rescan.connect('clicked', refill);
        open.connect('clicked', () => {
            try {
                const f = Gio.File.new_for_path(dir);
                try { f.make_directory_with_parents(null); } catch (_e) { /* đã có */ }
                Gio.AppInfo.launch_default_for_uri(f.get_uri(), null);
            } catch (e) {
                logError(e, 'koipond open fish/');
            }
        });
        refill();
        return group;
    }

    _makeRow(settings, r) {
        if (r.type === 'bool') {
            const row = new Adw.SwitchRow({title: r.title, subtitle: r.sub ?? ''});
            settings.bind(r.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        }
        const step = r.step ?? 1;
        const adj = new Gtk.Adjustment({
            lower: r.min,
            upper: r.max,
            step_increment: step,
            page_increment: step * 10,
            value: r.def,
        });
        const row = new Adw.SpinRow({
            title: r.title,
            subtitle: r.sub ?? '',
            adjustment: adj,
            digits: r.type === 'int' ? 0 : (r.digits ?? 2),
        });
        settings.bind(r.key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
