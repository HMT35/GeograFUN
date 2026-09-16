#!/usr/bin/env python3
"""
plains-editor.py  --  editor GUI pentru trasarea campiilor Europei.

Descarca singur harta de altitudine a Europei (cu bara de progres), o
afiseaza ca strat colorat sub 200 m si te lasa sa trasezi peste ea
poligoanele campiilor, denumindu-le. Rezultatul se salveaza in
assets/data/raw/campii_export.geojson, in formatul asteptat de
data-loader.js (Feature cu properties.name).

Sursa DEM: AWS Terrain Tiles (terrarium PNG), public, fara cont/API key.
    h = (R * 256 + G + B / 256) - 32768
La z=6 rezolutia e ~2 km/pixel in Europa centrala.

Dependinte:
    pip install requests pillow numpy
Rulare:
    python tools/plains-editor.py

Comenzi:
    click stanga        adauga un varf
    click dreapta       sterge ultimul varf
    Enter               inchide poligonul si cere numele
    Escape              anuleaza poligonul in lucru
    click mijloc / drag panare
    rotita              zoom
    Delete              sterge campia selectata
    F2                  redenumeste campia selectata
    Ctrl+S              salveaza
"""

import io
import json
import math
import os
import queue
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog, filedialog

try:
    import numpy as np
    import requests
    from PIL import Image, ImageTk
except ImportError as e:
    sys.exit("Lipseste o dependinta: %s\nRuleaza: pip install requests pillow numpy" % e)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LAND = os.path.join(ROOT, "assets", "data", "base", "land.geojson")
COUNTRIES = os.path.join(ROOT, "assets", "data", "raw", "tari_export.json")
OUT = os.path.join(ROOT, "assets", "data", "raw", "campii_export.geojson")
CACHE = os.path.join(ROOT, "tools", "_dem_eu_z6.npy")

# ---- DEM -------------------------------------------------------------
BBOX = (-11.0, 34.0, 60.0, 71.5)      # min_lon, min_lat, max_lon, max_lat
ZOOM = 6                               # ~2 km/px la latitudinea Europei
TILE = 256
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORKERS = 8

DEFAULT_MAX_ALT = 200                  # pragul de campie (programa RO)

START_CENTER = (54.0, 15.0)
START_ZOOM = 4.0
COORD_DECIMALS = 4

SUGGESTED = [
    "Câmpia Europei de Est",
    "Câmpia Nord-Europeană",
    "Bazinul Parizian",
    "Câmpia Panonică",
    "Câmpia Padului",
    "Câmpia Română",
    "Câmpia Precaspică",
    "Câmpia Andaluziei",
    "Câmpia Aquitaniei",
    "Câmpia Finlandei",
    "Câmpia Flandrei",
    "Câmpia Poloneză",
    "Câmpia Ebrului",
    "Câmpia Portugheză",
    "Câmpia Angliei de Est",
    "Câmpia Tisei",
]

COL = {
    "sea":      "#12203c",
    "land":     "#e9edf4",
    "border":   "#8fa2c8",
    "poly":     "#4facfe",
    "polyfill": "#1d5fa8",
    "sel":      "#43e97b",
    "draw":     "#ff4d6d",
    "vertex":   "#ffffff",
}

# culoarea benzii de campie (galben-oliv, ca in hartile fizice)
LOWLAND_RGB = (201, 192, 46)
LOWLAND_ALPHA = 200


# ------------------------------------------------------------ proiectie

def merc_y(lat):
    lat = max(-85.05, min(85.05, lat))
    r = math.radians(lat)
    return math.degrees(math.log(math.tan(r) + 1.0 / math.cos(r)))


def inv_merc_y(y):
    return math.degrees(math.atan(math.sinh(math.radians(y))))


def lon2px(lon, z):
    """Longitudine -> pixel global Web Mercator."""
    return (lon + 180.0) / 360.0 * (TILE * 2 ** z)


def lat2px(lat, z):
    lat = max(-85.05, min(85.05, lat))
    r = math.radians(lat)
    y = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0
    return y * (TILE * 2 ** z)


def px2lon(px, z):
    return px / (TILE * 2 ** z) * 360.0 - 180.0


def px2lat(py, z):
    n = math.pi - 2.0 * math.pi * py / (TILE * 2 ** z)
    return math.degrees(math.atan(math.sinh(n)))


class View:
    """Web Mercator: lon/lat <-> pixeli de ecran."""

    def __init__(self, center, zoom):
        self.clat, self.clon = center
        self.zoom = zoom
        self.w = 1
        self.h = 1

    @property
    def scale(self):
        return 256.0 * (2 ** self.zoom) / 360.0   # px / grad longitudine

    def to_screen(self, lon, lat):
        s = self.scale
        return ((lon - self.clon) * s + self.w / 2.0,
                (merc_y(self.clat) - merc_y(lat)) * s + self.h / 2.0)

    def to_geo(self, x, y):
        s = self.scale
        lon = (x - self.w / 2.0) / s + self.clon
        lat = inv_merc_y(merc_y(self.clat) - (y - self.h / 2.0) / s)
        return lon, lat

    def pan_px(self, dx, dy):
        s = self.scale
        self.clon -= dx / s
        self.clat = inv_merc_y(merc_y(self.clat) + dy / s)

    def zoom_at(self, x, y, step):
        lon0, lat0 = self.to_geo(x, y)
        self.zoom = max(1.0, min(12.0, self.zoom + step))
        lon1, lat1 = self.to_geo(x, y)
        self.clon += lon0 - lon1
        self.clat = inv_merc_y(merc_y(self.clat) + merc_y(lat0) - merc_y(lat1))


# ------------------------------------------------------------ geojson

def rings_of(geom):
    if not geom:
        return []
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Polygon":
        return list(c)
    if t == "MultiPolygon":
        out = []
        for poly in c:
            out.extend(poly)
        return out
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return list(c)
    return []


def load_fc(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1:
                inside = not inside
    return inside


# ------------------------------------------------------------ DEM

class Dem:
    """Rasterul de altitudine, in grila de pixeli Web Mercator la ZOOM."""

    def __init__(self):
        self.elev = None
        self.ox = 0          # offset pixel global al coltului stanga-sus
        self.oy = 0

    @property
    def ready(self):
        return self.elev is not None

    def tile_range(self):
        x0 = int(lon2px(BBOX[0], ZOOM) // TILE)
        x1 = int(lon2px(BBOX[2], ZOOM) // TILE)
        y0 = int(lat2px(BBOX[3], ZOOM) // TILE)
        y1 = int(lat2px(BBOX[1], ZOOM) // TILE)
        return x0, y0, x1, y1

    def load_cache(self):
        if not os.path.exists(CACHE):
            return False
        try:
            arr = np.load(CACHE)
        except Exception:
            return False
        x0, y0, x1, y1 = self.tile_range()
        if arr.shape != ((y1 - y0 + 1) * TILE, (x1 - x0 + 1) * TILE):
            return False
        self.elev = arr
        self.ox, self.oy = x0 * TILE, y0 * TILE
        return True

    def download(self, progress, cancel):
        """progress(done, total, msg); cancel() -> bool."""
        x0, y0, x1, y1 = self.tile_range()
        nx, ny = x1 - x0 + 1, y1 - y0 + 1
        total = nx * ny
        elev = np.zeros((ny * TILE, nx * TILE), dtype=np.float32)

        jobs = [(tx, ty) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)]
        lock = threading.Lock()
        state = {"done": 0, "fail": 0}

        def fetch(job):
            tx, ty = job
            if cancel():
                return
            sess = getattr(_local, "sess", None)
            if sess is None:
                sess = _local.sess = requests.Session()
            h = None
            for attempt in range(3):
                try:
                    r = sess.get(TILE_URL.format(z=ZOOM, x=tx, y=ty), timeout=20)
                    r.raise_for_status()
                    img = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"),
                                     dtype=np.float32)
                    h = img[:, :, 0] * 256.0 + img[:, :, 1] + img[:, :, 2] / 256.0 - 32768.0
                    break
                except Exception:
                    if attempt == 2:
                        h = None
            with lock:
                if h is None:
                    state["fail"] += 1
                else:
                    ry, rx = (ty - y0) * TILE, (tx - x0) * TILE
                    elev[ry:ry + TILE, rx:rx + TILE] = h
                state["done"] += 1
                progress(state["done"], total,
                         "Descarc harta de altitudine... %d/%d" % (state["done"], total))

        _local = threading.local()
        threads = []
        chunk = math.ceil(len(jobs) / WORKERS)
        for i in range(0, len(jobs), chunk):
            part = jobs[i:i + chunk]
            t = threading.Thread(target=lambda p=part: [fetch(j) for j in p], daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

        if cancel():
            return False, state["fail"]

        self.elev = elev
        self.ox, self.oy = x0 * TILE, y0 * TILE
        try:
            np.save(CACHE, elev)
        except Exception as ex:
            print("Nu am putut scrie cache-ul: %s" % ex)
        return True, state["fail"]

    def mask_image(self, max_alt):
        """RGBA PIL Image: colorat unde 0 < h <= max_alt, restul transparent."""
        m = (self.elev > 0) & (self.elev <= max_alt)
        h, w = m.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[m, 0] = LOWLAND_RGB[0]
        rgba[m, 1] = LOWLAND_RGB[1]
        rgba[m, 2] = LOWLAND_RGB[2]
        rgba[m, 3] = LOWLAND_ALPHA
        return Image.fromarray(rgba, "RGBA"), int(m.sum())


# ------------------------------------------------------------ aplicatia

class Editor(tk.Tk):

    def __init__(self):
        super().__init__()
        self.title("GeograFUN - Editor câmpii")
        self.geometry("1400x900")

        self.view = View(START_CENTER, START_ZOOM)
        self.dem = Dem()
        self.mask_img = None
        self._photo = None
        self.polygons = []
        self.draft = []
        self.selected = None
        self.drag = None
        self.dirty = False
        self._cancel = False
        self._q = queue.Queue()

        self._build_ui()
        self._load_background()
        self._load_existing()
        self.after(120, self.redraw)
        self.after(200, self.start_dem)
        self.after(100, self._pump)

    # -------------------------------------------------- UI

    def _build_ui(self):
        bar = tk.Frame(self, bg="#18213a")
        bar.pack(side="top", fill="x")

        def btn(text, cmd):
            tk.Button(bar, text=text, command=cmd, bg="#26325a", fg="#ffffff",
                      activebackground="#35447a", activeforeground="#ffffff",
                      relief="flat", padx=10, pady=5, bd=0
                      ).pack(side="left", padx=3, pady=6)

        btn("Închide poligonul", self.finish_draft)
        btn("Anulează", self.cancel_draft)
        btn("Redenumește", self.rename_selected)
        btn("Șterge", self.delete_selected)
        btn("Salvează", self.save)
        btn("Încarcă...", self.load_dialog)

        self.chk_low = tk.IntVar(value=1)
        tk.Checkbutton(bar, text="altitudine", variable=self.chk_low,
                       command=self.redraw, bg="#18213a", fg="#cfe0ff",
                       selectcolor="#18213a", activebackground="#18213a",
                       activeforeground="#ffffff", bd=0).pack(side="left", padx=(12, 2))

        self.chk_bord = tk.IntVar(value=1)
        tk.Checkbutton(bar, text="granițe", variable=self.chk_bord,
                       command=self.redraw, bg="#18213a", fg="#cfe0ff",
                       selectcolor="#18213a", activebackground="#18213a",
                       activeforeground="#ffffff", bd=0).pack(side="left")

        tk.Label(bar, text="prag (m):", bg="#18213a", fg="#cfe0ff").pack(side="left", padx=(12, 3))
        self.alt_var = tk.StringVar(value=str(DEFAULT_MAX_ALT))
        sp = tk.Spinbox(bar, from_=50, to=1000, increment=50, width=5,
                        textvariable=self.alt_var, command=self.rebuild_mask,
                        bg="#0e1526", fg="#ffffff", buttonbackground="#26325a",
                        relief="flat", insertbackground="#ffffff")
        sp.pack(side="left")
        sp.bind("<Return>", lambda e: self.rebuild_mask())

        body = tk.Frame(self)
        body.pack(side="top", fill="both", expand=True)

        side = tk.Frame(body, bg="#141c33", width=280)
        side.pack(side="right", fill="y")
        side.pack_propagate(False)

        tk.Label(side, text="Câmpii trasate", bg="#141c33", fg="#ffffff",
                 font=("Segoe UI", 11, "bold")).pack(pady=(12, 6))

        self.listbox = tk.Listbox(side, bg="#0e1526", fg="#dce6ff",
                                  selectbackground="#2b7fd4", bd=0,
                                  highlightthickness=0, font=("Segoe UI", 10),
                                  activestyle="none")
        self.listbox.pack(fill="both", expand=True, padx=10, pady=6)
        self.listbox.bind("<<ListboxSelect>>", self.on_list_select)
        self.listbox.bind("<Double-Button-1>", lambda e: self.zoom_to_selected())

        tk.Label(side, text="dublu-click = zoom pe câmpie",
                 bg="#141c33", fg="#7f8dbd", font=("Segoe UI", 8)).pack(pady=(0, 10))

        self.canvas = tk.Canvas(body, bg=COL["sea"], highlightthickness=0)
        self.canvas.pack(side="left", fill="both", expand=True)

        foot = tk.Frame(self, bg="#18213a")
        foot.pack(side="bottom", fill="x")

        self.progress = ttk.Progressbar(foot, mode="determinate", length=260)
        self.progress.pack(side="left", padx=10, pady=6)
        self.progress.pack_forget()

        self.retry_btn = tk.Button(foot, text="Reîncearcă descărcarea",
                                   command=self.start_dem, bg="#26325a", fg="#ffffff",
                                   relief="flat", padx=10, bd=0)

        self.status = tk.Label(foot, text="", bg="#18213a", fg="#9fb4dd",
                               anchor="w", padx=10, font=("Consolas", 9))
        self.status.pack(side="left", fill="x", expand=True)

        c = self.canvas
        c.bind("<Configure>", lambda e: self.redraw())
        c.bind("<Button-1>", self.on_click)
        c.bind("<Button-3>", self.on_right_click)
        c.bind("<Button-2>", self.on_pan_start)
        c.bind("<B2-Motion>", self.on_pan_move)
        c.bind("<ButtonRelease-2>", lambda e: setattr(self, "drag", None))
        c.bind("<Motion>", self.on_motion)
        c.bind("<MouseWheel>", self.on_wheel)

        self.bind("<Return>", lambda e: self.finish_draft())
        self.bind("<Escape>", lambda e: self.cancel_draft())
        self.bind("<Delete>", lambda e: self.delete_selected())
        self.bind("<F2>", lambda e: self.rename_selected())
        self.bind("<Control-s>", lambda e: self.save())
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    # -------------------------------------------------- DEM

    def start_dem(self):
        self.retry_btn.pack_forget()
        if self.dem.ready:
            return
        if self.dem.load_cache():
            self._q.put(("done", 0))
            return
        self._cancel = False
        self.progress.pack(side="left", padx=10, pady=6)
        self.progress["value"] = 0
        self.set_status("Pornesc descărcarea hărții de altitudine...")
        threading.Thread(target=self._dem_worker, daemon=True).start()

    def _dem_worker(self):
        try:
            ok, fail = self.dem.download(
                lambda d, t, m: self._q.put(("prog", (d, t, m))),
                lambda: self._cancel)
            self._q.put(("done", fail) if ok else ("cancelled", 0))
        except Exception as ex:
            self._q.put(("error", str(ex)))

    def _pump(self):
        """Preia mesajele firelor de executie in firul UI."""
        try:
            while True:
                kind, payload = self._q.get_nowait()
                if kind == "prog":
                    d, t, msg = payload
                    self.progress["maximum"] = t
                    self.progress["value"] = d
                    self.set_status(msg)
                elif kind == "done":
                    self.progress.pack_forget()
                    self.rebuild_mask()
                    if payload:
                        self.set_status("Altitudine încărcată (%d tile-uri au eșuat)." % payload)
                elif kind == "cancelled":
                    self.progress.pack_forget()
                    self.set_status("Descărcare anulată.")
                elif kind == "error":
                    self.progress.pack_forget()
                    self.retry_btn.pack(side="left", padx=6)
                    self.set_status("Eroare la descărcare: %s" % payload)
        except queue.Empty:
            pass
        self.after(100, self._pump)

    def rebuild_mask(self):
        if not self.dem.ready:
            return
        try:
            alt = int(self.alt_var.get())
        except ValueError:
            alt = DEFAULT_MAX_ALT
        self.mask_img, count = self.dem.mask_image(alt)
        if count == 0:
            self.set_status("Nicio zonă sub %d m — verifică pragul." % alt)
            self.mask_img = None
        self.redraw()

    # -------------------------------------------------- fundal vectorial

    def _load_background(self):
        self.land_rings = []
        self.border_rings = []

        fc = load_fc(LAND)
        if fc:
            for f in fc.get("features", []):
                self.land_rings.extend(rings_of(f.get("geometry")))

        fc = load_fc(COUNTRIES)
        if fc:
            for f in fc.get("features", []):
                self.border_rings.extend(rings_of(f.get("geometry")))

    def _load_existing(self):
        fc = load_fc(OUT)
        if not fc:
            return
        for f in fc.get("features", []):
            geom = f.get("geometry") or {}
            name = (f.get("properties") or {}).get("name")
            if geom.get("type") == "Polygon" and name:
                self.polygons.append(
                    {"name": name,
                     "coords": [list(p) for p in geom["coordinates"][0][:-1]]})
        self.refresh_list()

    # -------------------------------------------------- desenare

    def redraw(self):
        c = self.canvas
        c.delete("all")
        self.view.w = c.winfo_width()
        self.view.h = c.winfo_height()
        if self.view.w < 10:
            return

        for ring in self.land_rings:
            pts = self._proj_ring(ring)
            if len(pts) >= 6:
                c.create_polygon(pts, fill=COL["land"], outline="", width=0)

        if self.chk_low.get():
            self._draw_dem()

        if self.chk_bord.get():
            for ring in self.border_rings:
                pts = self._proj_ring(ring)
                if len(pts) >= 4:
                    c.create_line(pts, fill=COL["border"], width=1)

        for i, poly in enumerate(self.polygons):
            pts = self._proj_ring(poly["coords"])
            if len(pts) < 6:
                continue
            sel = (i == self.selected)
            c.create_polygon(pts, fill=COL["polyfill"], stipple="gray50",
                             outline=COL["sel"] if sel else COL["poly"],
                             width=3 if sel else 2)
            cx = sum(pts[0::2]) / (len(pts) // 2)
            cy = sum(pts[1::2]) / (len(pts) // 2)
            c.create_text(cx, cy, text=poly["name"], fill="#ffffff",
                          font=("Segoe UI", 9, "bold"))

        if self.draft:
            pts = self._proj_ring(self.draft)
            if len(pts) >= 4:
                c.create_line(pts, fill=COL["draw"], width=2)
            for i in range(0, len(pts), 2):
                c.create_oval(pts[i] - 3, pts[i + 1] - 3, pts[i] + 3, pts[i + 1] + 3,
                              fill=COL["vertex"], outline=COL["draw"])

        self.update_status()

    def _draw_dem(self):
        """Decupeaza din masca raster fereastra curenta si o pune pe canvas."""
        if self.mask_img is None:
            return
        v = self.view
        W, H = int(v.w), int(v.h)
        dw, dh = self.mask_img.size

        lon0, lat0 = v.to_geo(0, 0)
        lon1, lat1 = v.to_geo(W, H)
        l = lon2px(lon0, ZOOM) - self.dem.ox
        r = lon2px(lon1, ZOOM) - self.dem.ox
        u = lat2px(lat0, ZOOM) - self.dem.oy
        b = lat2px(lat1, ZOOM) - self.dem.oy
        if r - l <= 0 or b - u <= 0:
            return

        s = W / (r - l)                     # px ecran / px DEM

        il, iu = max(0.0, l), max(0.0, u)
        ir, ib = min(float(dw), r), min(float(dh), b)
        if ir - il < 1 or ib - iu < 1:
            return

        tw = max(1, int(round((ir - il) * s)))
        th = max(1, int(round((ib - iu) * s)))
        if tw > 4000 or th > 4000:
            return

        resample = Image.NEAREST if s > 1 else Image.BILINEAR
        crop = self.mask_img.resize((tw, th), resample,
                                    box=(il, iu, ir, ib))

        self._photo = ImageTk.PhotoImage(crop)
        self.canvas.create_image(int((il - l) * s), int((iu - u) * s),
                                 anchor="nw", image=self._photo)

    def _proj_ring(self, ring):
        v = self.view
        pts = []
        for p in ring:
            x, y = v.to_screen(p[0], p[1])
            pts.extend((max(-20000.0, min(20000.0, x)),
                        max(-20000.0, min(20000.0, y))))
        return pts

    def set_status(self, text):
        self.status.config(text=text)

    def update_status(self):
        if self.progress.winfo_ismapped():
            return
        dem = "altitudine: OK" if self.dem.ready else "altitudine: lipsă"
        d = " | în lucru: %d vârfuri" % len(self.draft) if self.draft else ""
        star = " *" if self.dirty else ""
        self.set_status("%d câmpii%s%s | %s | zoom %.1f | click=vârf, dreapta=undo, Enter=închide"
                        % (len(self.polygons), star, d, dem, self.view.zoom))

    # -------------------------------------------------- mouse

    def on_click(self, e):
        lon, lat = self.view.to_geo(e.x, e.y)
        if not self.draft:
            hit = self._hit_test(lon, lat)
            if hit is not None:
                self.selected = hit
                self.listbox.selection_clear(0, "end")
                self.listbox.selection_set(hit)
                self.redraw()
                return
        self.draft.append([lon, lat])
        self.dirty = True
        self.redraw()

    def on_right_click(self, e):
        if self.draft:
            self.draft.pop()
            self.redraw()

    def on_pan_start(self, e):
        self.drag = (e.x, e.y)

    def on_pan_move(self, e):
        if not self.drag:
            return
        dx, dy = e.x - self.drag[0], e.y - self.drag[1]
        self.drag = (e.x, e.y)
        self.view.pan_px(dx, dy)
        self.redraw()

    def on_motion(self, e):
        lon, lat = self.view.to_geo(e.x, e.y)
        txt = "GeograFUN - Editor câmpii   [%.3f, %.3f]" % (lat, lon)
        if self.dem.ready:
            px = int(lon2px(lon, ZOOM) - self.dem.ox)
            py = int(lat2px(lat, ZOOM) - self.dem.oy)
            h, w = self.dem.elev.shape
            if 0 <= px < w and 0 <= py < h:
                txt += "   %d m" % round(float(self.dem.elev[py, px]))
        self.title(txt)

    def on_wheel(self, e):
        self.view.zoom_at(e.x, e.y, 0.4 if e.delta > 0 else -0.4)
        self.redraw()

    def _hit_test(self, lon, lat):
        for i in range(len(self.polygons) - 1, -1, -1):
            if point_in_ring(lon, lat, self.polygons[i]["coords"]):
                return i
        return None

    # -------------------------------------------------- actiuni

    def finish_draft(self):
        if len(self.draft) < 3:
            messagebox.showinfo("Prea puține vârfuri",
                                "Un poligon are nevoie de cel puțin 3 vârfuri.")
            return
        name = NameDialog(self, SUGGESTED).result
        if not name:
            return
        self.polygons.append({"name": name, "coords": self.draft})
        self.draft = []
        self.dirty = True
        self.refresh_list()
        self.redraw()

    def cancel_draft(self):
        self.draft = []
        self.redraw()

    def rename_selected(self):
        if self.selected is None:
            return
        name = simpledialog.askstring(
            "Redenumește", "Numele câmpiei:",
            initialvalue=self.polygons[self.selected]["name"], parent=self)
        if name:
            self.polygons[self.selected]["name"] = name.strip()
            self.dirty = True
            self.refresh_list()
            self.redraw()

    def delete_selected(self):
        if self.selected is None:
            return
        if messagebox.askyesno("Ștergere",
                               "Ștergi „%s”?" % self.polygons[self.selected]["name"]):
            self.polygons.pop(self.selected)
            self.selected = None
            self.dirty = True
            self.refresh_list()
            self.redraw()

    def zoom_to_selected(self):
        if self.selected is None:
            return
        ring = self.polygons[self.selected]["coords"]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        self.view.clon = (min(xs) + max(xs)) / 2.0
        self.view.clat = inv_merc_y((merc_y(min(ys)) + merc_y(max(ys))) / 2.0)
        span = max(max(xs) - min(xs), merc_y(max(ys)) - merc_y(min(ys)), 0.5)
        self.view.zoom = max(1.0, min(12.0,
                             math.log2(360.0 * self.view.w / (256.0 * span * 1.4))))
        self.redraw()

    def on_list_select(self, _e):
        sel = self.listbox.curselection()
        self.selected = sel[0] if sel else None
        self.redraw()

    def refresh_list(self):
        self.listbox.delete(0, "end")
        for p in self.polygons:
            self.listbox.insert("end", "  %s  (%d)" % (p["name"], len(p["coords"])))

    # -------------------------------------------------- fisiere

    def save(self):
        feats = []
        for p in self.polygons:
            ring = [[round(c[0], COORD_DECIMALS), round(c[1], COORD_DECIMALS)]
                    for c in p["coords"]]
            if ring[0] != ring[-1]:
                ring.append(list(ring[0]))
            feats.append({
                "type": "Feature",
                "properties": {"name": p["name"], "name:ro": p["name"]},
                "geometry": {"type": "Polygon", "coordinates": [ring]}
            })
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f,
                      ensure_ascii=False, separators=(",", ":"))
        self.dirty = False
        messagebox.showinfo("Salvat", "Scris %d câmpii în\n%s\n(%.0f KB)"
                            % (len(feats), OUT, os.path.getsize(OUT) / 1024.0))
        self.update_status()

    def load_dialog(self):
        path = filedialog.askopenfilename(
            title="Încarcă GeoJSON cu câmpii",
            filetypes=[("GeoJSON", "*.geojson *.json"), ("Toate", "*.*")])
        if not path:
            return
        fc = load_fc(path)
        if not fc:
            messagebox.showerror("Eroare", "Nu am putut citi fișierul.")
            return
        self.polygons = []
        for f in fc.get("features", []):
            geom = f.get("geometry") or {}
            name = (f.get("properties") or {}).get("name")
            if geom.get("type") == "Polygon" and name:
                self.polygons.append(
                    {"name": name,
                     "coords": [list(p) for p in geom["coordinates"][0][:-1]]})
        self.selected = None
        self.refresh_list()
        self.redraw()

    def on_close(self):
        if self.dirty and not messagebox.askyesno(
                "Ieșire", "Ai modificări nesalvate. Ieși oricum?"):
            return
        self._cancel = True
        self.destroy()


class NameDialog(simpledialog.Dialog):

    def __init__(self, parent, suggestions):
        self.suggestions = suggestions
        self.result = None
        super().__init__(parent, "Numele câmpiei")

    def body(self, master):
        tk.Label(master, text="Nume:").grid(row=0, column=0, sticky="w", pady=4)
        self.entry = tk.Entry(master, width=38)
        self.entry.grid(row=0, column=1, pady=4, padx=6)

        tk.Label(master, text="Sugestii:").grid(row=1, column=0, sticky="nw", pady=4)
        self.lb = tk.Listbox(master, width=38, height=12, activestyle="none")
        for s in self.suggestions:
            self.lb.insert("end", s)
        self.lb.grid(row=1, column=1, pady=4, padx=6)
        self.lb.bind("<<ListboxSelect>>", self._pick)
        self.lb.bind("<Double-Button-1>", lambda e: self.ok())
        return self.entry

    def _pick(self, _e):
        sel = self.lb.curselection()
        if sel:
            self.entry.delete(0, "end")
            self.entry.insert(0, self.suggestions[sel[0]])

    def apply(self):
        self.result = self.entry.get().strip() or None


if __name__ == "__main__":
    Editor().mainloop()
