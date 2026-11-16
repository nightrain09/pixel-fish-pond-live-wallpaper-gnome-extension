// Koi Pond Wallpaper: Preferences window (GNOME Shell 45-49)
// The UI is built automatically from settings-spec.js.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SCHEMA_ID, SPEC} from './settings-spec.js';

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
                const row = this._makeRow(settings, r);
                rows.set(r.key, row);
                group.add(row);
            }
            // rows that depend on a switch are greyed out while it is off
            for (const r of g.rows) {
                if (r.dependsOn)
                    settings.bind(r.dependsOn, rows.get(r.key), 'sensitive', Gio.SettingsBindFlags.GET);
            }
            page.add(group);

            const resetGroup = new Adw.PreferencesGroup();
            const btn = new Gtk.Button({
                label: 'Reset this page to defaults',
                halign: Gtk.Align.START,
            });
            btn.connect('clicked', () => {
                for (const r of g.rows)
                    settings.reset(r.key);
            });
            resetGroup.add(btn);
            page.add(resetGroup);

            window.add(page);
        }
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
