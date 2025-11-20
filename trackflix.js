const LIBRARY_KEY = "trackflix_library_v1";
const USER_DATA_PREFIX = "trackflix_user_v1_";

let items = [];
let history = [];
let plans = [];

// Firestore helper (ako postoji)
const TF = window.tfFirestore || null;


/* ---------- PERSIST ---------- */

async function loadData() {
  try {
    let libraryItems = [];

    // 1) PROBAJ IZ FIRESTORE-A (shared library za sve)
    if (TF) {
      try {
        const snap = await TF.getDocs(TF.collection(TF.db, "library"));
        snap.forEach(docSnap => {
          const data = docSnap.data();
          libraryItems.push(data);
        });
      } catch (err) {
        console.error("Firestore library load error:", err);
      }
    }

    // 2) AKO NEMA NIŠTA U CLOUDU -> stari localStorage fallback
    if (!libraryItems.length) {
      const rawLib = localStorage.getItem(LIBRARY_KEY);

      if (rawLib) {
        libraryItems = JSON.parse(rawLib);
      } else {
        const oldRaw = localStorage.getItem("trackflix_v9");
        if (oldRaw) {
          try {
            const oldParsed = JSON.parse(oldRaw);
            libraryItems = (oldParsed.items || []).map(it => ({
              id: it.id,
              type: it.type,
              title: it.title,
              posterUrl: it.posterUrl || null,
              description: it.description || null,
              author: it.author || null,
              seasons: it.seasons || null,
              totalEpisodes: it.totalEpisodes || 0,
              totalPages: it.totalPages || 0,
              durationMinutes: it.durationMinutes || null
            }));
            localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryItems));
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    // ako i dalje nema ničega -> prazno
    items = (libraryItems || []).map(it => ({ ...it }));

    // 3) UČITAJ USER-SPECIFIC PODATKE (history, plans, itemStateById)
    history = [];
    plans = [];
    const stateById = {};
    const nick = getCurrentUserNick();

    // ako imamo Firestore + user nick -> pokušaj iz clouda
    if (TF && nick) {
      try {
        const userRef = TF.doc(TF.db, "users", nick);
        const snapUser = await TF.getDoc(userRef);
        if (snapUser.exists()) {
          const data = snapUser.data();
          history = data.history || [];
          plans = data.plans || [];
          Object.assign(stateById, data.itemStateById || {});
        } else {
          // nema u cloudu -> probaj iz localStorage (stari način)
          const userKey = getUserStorageKey();
          const rawUser = localStorage.getItem(userKey);
          if (rawUser) {
            try {
              const parsedUser = JSON.parse(rawUser);
              history = parsedUser.history || [];
              plans = parsedUser.plans || [];
              Object.assign(stateById, parsedUser.itemStateById || {});
            } catch (e) {
              console.error(e);
            }
          }
        }
      } catch (err) {
        console.error("Firestore user load error:", err);
        // fallback na localStorage
        const userKey = getUserStorageKey();
        const rawUser = localStorage.getItem(userKey);
        if (rawUser) {
          try {
            const parsedUser = JSON.parse(rawUser);
            history = parsedUser.history || [];
            plans = parsedUser.plans || [];
            Object.assign(stateById, parsedUser.itemStateById || {});
          } catch (e) {
            console.error(e);
          }
        }
      }
    } else {
      // nema Firestore-a ili nema nicka -> čitaj samo iz localStorage (stari način)
      const userKey = getUserStorageKey();
      const rawUser = localStorage.getItem(userKey);
      if (rawUser) {
        try {
          const parsedUser = JSON.parse(rawUser);
          history = parsedUser.history || [];
          plans = parsedUser.plans || [];
          Object.assign(stateById, parsedUser.itemStateById || {});
        } catch (e) {
          console.error(e);
        }
      }
    }

    // 4) SPOJI USER STATE U items (isto kao prije)
    items.forEach(it => {
      const st = stateById[it.id];
      if (st) {
        it.inList = !!st.inList;
        it.progress = st.progress || 0;
        it.started = !!st.started;
        it.pagesRead = st.pagesRead || 0;
        it.timeWatched = st.timeWatched || 0;
        it.rating = st.rating ?? null;
      } else {
        it.inList = false;
        it.progress = 0;
        it.started = false;
        it.pagesRead = 0;
        it.timeWatched = 0;
        it.rating = null;
      }
    });
  } catch (e) {
    console.error(e);
    items = [];
    history = [];
    plans = [];
  }
}

function getUserSnapshotByNick(nick) {
  // 1) učitaj zajednički library
  const rawLib = localStorage.getItem(LIBRARY_KEY);
  let libraryItems = [];
  if (rawLib) {
    try {
      libraryItems = JSON.parse(rawLib) || [];
    } catch (e) {
      console.error(e);
      libraryItems = [];
    }
  }

  // 2) učitaj user-specifične podatke (item state + history + plans)
  const userKey = USER_DATA_PREFIX + nick;
  const stateById = {};
  let userHistory = [];
  let userPlans = [];

  const rawUser = localStorage.getItem(userKey);
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser);
      Object.assign(stateById, parsed.itemStateById || {});
      userHistory = parsed.history || [];
      userPlans = parsed.plans || [];
    } catch (e) {
      console.error(e);
    }
  }

  // 3) spoji library + njihov state
  const userItems = libraryItems.map(base => {
    const st = stateById[base.id] || {};
    return {
      ...base,
      inList: !!st.inList,
      progress: st.progress || 0,
      started: !!st.started,
      pagesRead: st.pagesRead || 0,
      timeWatched: st.timeWatched || 0,
      rating: st.rating ?? null,
    };
  });

  return {
    nick,
    items: userItems,
    history: userHistory,
    plans: userPlans,
  };
}

async function saveData() {
  try {
    // 1) SPREMI ZAJEDNIČKI LIBRARY U LOCALSTORAGE (backup / offline)
    const libraryToSave = items.map(it => ({
      id: it.id,
      type: it.type,
      title: it.title,
      posterUrl: it.posterUrl || null,
      description: it.description || null,
      author: it.author || null,
      seasons: it.seasons || null,
      totalEpisodes: it.totalEpisodes || 0,
      totalPages: it.totalPages || 0,
      durationMinutes: it.durationMinutes || null
    }));
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(libraryToSave));

    // 2) SPREMI USER STATE ZA TRENUTNOG USERA U LOCALSTORAGE
    const itemStateById = {};
    items.forEach(it => {
      itemStateById[it.id] = {
        inList: !!it.inList,
        progress: it.progress || 0,
        started: !!it.started,
        pagesRead: it.pagesRead || 0,
        timeWatched: it.timeWatched || 0,
        rating: it.rating ?? null
      };
    });

    const userKey = getUserStorageKey();
    const userPayload = {
      itemStateById,
      history,
      plans
    };
    localStorage.setItem(userKey, JSON.stringify(userPayload));

    // 3) SPREMI SVE I U FIRESTORE (ako je dostupan)
    if (TF) {
      // shared library – svi dijele isti
      for (const it of libraryToSave) {
        const ref = TF.doc(TF.db, "library", String(it.id));
        await TF.setDoc(ref, it, { merge: true });
      }

      const nick = getCurrentUserNick();
      if (nick) {
        const userRef = TF.doc(TF.db, "users", nick);
        await TF.setDoc(userRef, userPayload, { merge: true });
      }
    }
  } catch (e) {
    console.error(e);
  }
}

function getCurrentUserNick() {
  const nick = localStorage.getItem("trackflix_current_user");
  return nick || null;
}

function getUserStorageKey() {
  const nick = getCurrentUserNick();
  return USER_DATA_PREFIX + (nick || "guest");
}

function dateKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ---------- STATUS & PROGRESS ---------- */

function getItemStatus(it) {
  if (it.inList === false) return "hidden";

  if (it.type === "movie") {
    if ((it.progress || 0) >= 1) return "watched";
    if (it.started || (it.timeWatched || 0) > 0) return "inprogress";
    return "unwatched";
  }

  if (it.type === "show") {
    const total = it.totalEpisodes || 0;
    if (total && (it.progress || 0) >= total) return "watched";
    if ((it.progress || 0) > 0 || it.started) return "inprogress";
    return "unwatched";
  }

  if (it.type === "book") {
    const total = it.totalPages || 0;
    const read = it.pagesRead || 0;
    if (total && read >= total) return "watched";
    if (read > 0 || it.started) return "inprogress";
    return "unwatched";
  }

  return "unwatched";
}

function getPercent(it) {
  if (it.type === "book") {
    if (!it.totalPages) return 0;
    return Math.round(((it.pagesRead || 0) / it.totalPages) * 100);
  }

  if (it.type === "movie") {
    if (it.durationMinutes && it.durationMinutes > 0) {
      let base = it.timeWatched || 0;
      if ((it.progress || 0) >= 1) {
        base = it.durationMinutes;
      }
      let pct = (base / it.durationMinutes) * 100;
      pct = Math.max(0, Math.min(100, pct));
      return Math.round(pct);
    }
    return Math.round(((it.progress || 0) / 1) * 100);
  }

  const total = it.totalEpisodes || 1;
  return Math.round(((it.progress || 0) / total) * 100);
}

function getShowPos(it) {
  if (it.type !== "show" || !it.seasons || !it.seasons.length) return null;
  const total = it.totalEpisodes || 0;
  let idx = Math.min(it.progress || 0, total);

  if (idx === 0) {
    return { season: 1, episode: 1, completed: false };
  }
  if (idx >= total) {
    return { completed: true };
  }

  let remaining = idx;
  for (const s of it.seasons) {
    if (remaining < s.episodes) {
      return {
        season: s.season,
        episode: remaining + 1,
        completed: false,
      };
    }
    remaining -= s.episodes;
  }
  return { completed: true };
}

/* ---------- HOME STATE ---------- */

let homeTab = "movies";
let homeStatus = "unwatched";
let homeSearch = "";

function renderHome() {
  const page = document.getElementById("homePage");
  page.innerHTML = `
    <div>
      <div class="tabs" id="homeTabs"></div>
      <div class="status-tabs" id="homeStatusTabs"></div>
      <div class="search"><input id="homeSearchInput" placeholder="Search by title..."></div>
      <div id="homeLuck"></div>
      <div id="homeList"></div>
    </div>
  `;

  const tabsEl = document.getElementById("homeTabs");
  tabsEl.innerHTML = `
    <button data-tab="movies" class="${homeTab === "movies" ? "active" : ""}">Movies</button>
    <button data-tab="shows" class="${homeTab === "shows" ? "active" : ""}">TV Shows</button>
    <button data-tab="books" class="${homeTab === "books" ? "active" : ""}">Books</button>
  `;
  tabsEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      homeTab = btn.dataset.tab;
      renderHome();
    });
  });

  const statusEl = document.getElementById("homeStatusTabs");
  statusEl.innerHTML = `
    <button data-status="unwatched" class="${homeStatus === "unwatched" ? "active" : ""}">
      ${homeTab === "books" ? "To be read" : "Unwatched"}
    </button>
    <button data-status="inprogress" class="${homeStatus === "inprogress" ? "active" : ""}">In progress</button>
    <button data-status="watched" class="${homeStatus === "watched" ? "active" : ""}">Finished</button>
  `;
  statusEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      homeStatus = btn.dataset.status;
      renderHome();
    });
  });

  const sInput = document.getElementById("homeSearchInput");
  sInput.value = homeSearch;
  sInput.addEventListener("input", () => {
    homeSearch = sInput.value.toLowerCase();
    renderHomeList();
  });

  renderHomeList();
}

function filterHomeItems() {
  return items.filter((it) => {
    const st = getItemStatus(it);
    if (st === "hidden") return false;

    if (homeTab === "movies" && it.type !== "movie") return false;
    if (homeTab === "shows" && it.type !== "show") return false;
    if (homeTab === "books" && it.type !== "book") return false;

    if (homeStatus === "unwatched" && st !== "unwatched") return false;
    if (homeStatus === "inprogress" && st !== "inprogress") return false;
    if (homeStatus === "watched" && st !== "watched") return false;

    if (homeSearch && !it.title.toLowerCase().includes(homeSearch)) return false;

    return true;
  });
}

function renderHomeList() {
  const listEl = document.getElementById("homeList");
  const luckEl = document.getElementById("homeLuck");
  const list = filterHomeItems();

  if (homeStatus === "unwatched" && list.length > 0) {
    luckEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:13px;opacity:0.8;">Not sure what to pick? Try your luck!</div>
        <button class="btn btn-info" id="luckBtn">Test your luck</button>
      </div>
    `;
    document.getElementById("luckBtn").addEventListener("click", () => {
      const choice = list[Math.floor(Math.random() * list.length)];
      openLuckModal(choice);
    });
  } else {
    luckEl.innerHTML = "";
  }

  if (!list.length) {
    listEl.innerHTML = `<p style="opacity:0.6;font-size:13px;">Nothing here.</p>`;
    return;
  }

  listEl.innerHTML = list.map((it) => homeCardHTML(it)).join("");

  list.forEach((it) => {
    const card = listEl.querySelector(`.card[data-id="${it.id}"]`);
    if (!card) return;
    const st = getItemStatus(it);

    if (it.type === "book") {
      if (st === "unwatched") {
        card.querySelector(".btn-start")?.addEventListener("click", () =>
          startReading(it.id)
        );
      } else {
        card.querySelector(".btn-update-pages")?.addEventListener(
          "click",
          () => updateBookPages(it.id)
        );
      }
    } else if (it.type === "movie") {
      if (st === "unwatched") {
        card.querySelector(".btn-start")?.addEventListener("click", () =>
          startWatching(it.id)
        );
      } else if (st === "inprogress") {
        card
          .querySelector(".btn-finish-movie")
          ?.addEventListener("click", () => finishMovie(it.id));
        card
          .querySelector(".btn-time-movie")
          ?.addEventListener("click", () => updateMovieTime(it.id));
      }
    } else if (it.type === "show") {
      if (st === "unwatched") {
        card.querySelector(".btn-start")?.addEventListener("click", () =>
          startWatching(it.id)
        );
      } else {
        card.querySelector(".btn-next")?.addEventListener("click", () =>
          nextEpisode(it.id)
        );
        card.querySelector(".btn-prev")?.addEventListener("click", () =>
          prevEpisode(it.id)
        );
      }
    }

    card.querySelector(".btn-edit")?.addEventListener("click", () =>
      openItemModal(it)
    );
    card.querySelector(".btn-remove-list")?.addEventListener("click", () =>
      removeFromList(it.id)
    );
    card.querySelectorAll(".rating-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = Number(btn.dataset.value);
        setRating(it.id, r);
      });
    });
  });
}

function homeCardHTML(it) {
  const st = getItemStatus(it);
  const pct = getPercent(it);

  const statusLabel =
    st === "unwatched"
      ? it.type === "book"
        ? "To be read"
        : "Unwatched"
      : st === "inprogress"
      ? "In progress"
      : "Finished";

  const pillClass =
    st === "unwatched"
      ? "pill unwatched"
      : st === "inprogress"
      ? "pill inprogress"
      : "pill finished";

  const typeLabel =
    it.type === "movie" ? "Movie" : it.type === "show" ? "TV Show" : "Book";

  let extra = "";
  if (it.type === "show") {
    const pos = getShowPos(it);
    extra += `<p style="font-size:13px;opacity:0.8;">Seasons: ${
      it.seasons ? it.seasons.length : 0
    } | Episodes: ${it.totalEpisodes || 0}</p>`;
    if (pos && pos.completed) {
      extra += `<p style="font-size:13px;color:#4ade80;">Completed</p>`;
    } else if (pos) {
      extra += `<p style="font-size:13px;opacity:0.9;">Currently: S${pos.season}E${pos.episode}</p>`;
    }
  } else if (it.type === "movie") {
    extra += `<p style="font-size:13px;opacity:0.9;">${
      st === "watched" ? "Watched" : "Not watched yet"
    }</p>`;
    if (it.durationMinutes) {
      const watchedLabel =
        (it.progress || 0) >= 1
          ? `${it.durationMinutes} min`
          : `${it.timeWatched || 0} min`;
      extra += `<p style="font-size:11px;opacity:0.7;">Duration: ${
        it.durationMinutes
      } min · Watched ${watchedLabel}</p>`;
    }
  } else if (it.type === "book") {
    extra += `<p style="font-size:13px;opacity:0.9;">Pages: ${
      it.pagesRead || 0
    } / ${it.totalPages || 0}</p>`;
    if (it.author) {
      extra += `<p style="font-size:11px;opacity:0.8;">by ${it.author}</p>`;
    }
  }

  let ratingPart = "";
  if (st === "watched") {
    const existing = it.rating
      ? `<p style="font-size:12px;margin-top:4px;">Your rating: <strong>${it.rating}</strong>/10</p>`
      : "";
    const buttons = Array.from({ length: 10 }, (_, i) => {
      const v = i + 1;
      const cls = "rating-btn" + (it.rating === v ? " active" : "");
      return `<button class="${cls}" data-value="${v}">${v}</button>`;
    }).join("");
    ratingPart = `${existing}<div class="rating-row">${buttons}</div>`;
  } else if (it.rating) {
    ratingPart = `<p style="font-size:12px;margin-top:4px;">Your rating: <strong>${it.rating}</strong>/10</p>`;
  }

  let mainActions = "";
  if (it.type === "book") {
    if (st === "unwatched") {
      mainActions += `<button class="btn btn-primary btn-start">Start reading</button>`;
    } else {
      mainActions += `<button class="btn btn-primary btn-update-pages">Update pages</button>`;
    }
  } else if (it.type === "movie") {
    if (st === "unwatched") {
      mainActions += `<button class="btn btn-primary btn-start">Start watching</button>`;
    } else if (st === "inprogress") {
      mainActions += `
        <button class="btn btn-primary btn-finish-movie">Finished</button>
        <button class="btn btn-secondary btn-time-movie">Time watched</button>
      `;
    }
  } else if (it.type === "show") {
    if (st === "unwatched") {
      mainActions += `<button class="btn btn-primary btn-start">Start watching</button>`;
    } else {
      mainActions += `
        <button class="btn btn-primary btn-next">Next episode</button>
        <button class="btn btn-secondary btn-prev">Previous episode</button>
      `;
    }
  }

  return `
    <div class="card" data-id="${it.id}">
      <div class="poster">
        ${
          it.posterUrl
            ? `<img src="${it.posterUrl}" alt="${it.title}">`
            : "No image"
        }
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:flex-start;gap:6px;">
          <div>
            <div style="font-weight:700;font-size:16px;">${it.title}</div>
            <div style="font-size:12px;opacity:0.7;">${typeLabel}</div>
          </div>
          <span class="${pillClass}">${statusLabel}</span>
        </div>
        ${
          it.description
            ? `<p style="font-size:13px;opacity:0.85;margin-top:2px;">${it.description}</p>`
            : ""
        }
        ${extra}
        <p style="font-size:11px;opacity:0.75;">Progress: ${pct}%</p>
        <div class="progress-bar">
          <div class="progress-bar-inner" style="width:${pct}%;"></div>
        </div>
        ${ratingPart}
      </div>
      <div class="card-actions">
        ${mainActions}
        <button class="btn btn-info btn-edit">Edit</button>
        <button class="btn btn-danger btn-remove-list">Remove</button>
      </div>
    </div>
  `;
}

function openLuckModal(item) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Test your luck</h2>
          <button class="icon-btn" id="luckClose">✖️</button>
        </div>
        <p style="margin-bottom:8px;font-size:14px;">You got:</p>
        <div class="card" style="margin-bottom:10px;">
          <div class="poster">
            ${
              item.posterUrl ? `<img src="${item.posterUrl}">` : "No image"
            }
          </div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:16px;">${item.title}</div>
            <div style="font-size:12px;opacity:0.7;">
              ${
                item.type === "movie"
                  ? "Movie"
                  : item.type === "show"
                  ? "TV Show"
                  : "Book"
              }
            </div>
            ${
              item.description
                ? `<p style="font-size:13px;opacity:0.85;margin-top:2px;">${item.description}</p>`
                : ""
            }
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="luckCancel">Close</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("luckClose").onclick =
    document.getElementById("luckCancel").onclick =
      () => {
        root.innerHTML = "";
      };
}

/* ---------- ACTIONS ---------- */

function startWatching(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  it.started = true;
  saveData();
  renderHome();
}

function startReading(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  it.started = true;
  saveData();
  renderHome();
}

function nextEpisode(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== "show") return;
  const total = it.totalEpisodes || 0;
  if (!total) return;
  const old = it.progress || 0;
  if (old >= total) return;
  it.progress = old + 1;
  it.started = true;

  const pos = getShowPos(it);
  history.push({
    id: Date.now() + "-show",
    itemId: it.id,
    type: "show",
    title: it.title,
    season: pos?.season || null,
    episode: pos?.episode || null,
    timestamp: new Date().toISOString(),
  });

  saveData();
  renderHome();
  renderCalendar();
}

function prevEpisode(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== "show") return;
  const old = it.progress || 0;
  if (old <= 0) return;
  it.progress = old - 1;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].itemId === id && history[i].type === "show") {
      history.splice(i, 1);
      break;
    }
  }

  saveData();
  renderHome();
  renderCalendar();
}

function finishMovie(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== "movie") return;

  if ((it.progress || 0) < 1) {
    it.progress = 1;
    it.started = true;
    if (it.durationMinutes) {
      it.timeWatched = it.durationMinutes;
    }

    history.push({
      id: Date.now() + "-movie",
      itemId: it.id,
      type: "movie",
      title: it.title,
      timestamp: new Date().toISOString(),
    });
  }

  saveData();
  renderHome();
  renderCalendar();
}

function updateMovieTime(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== "movie") return;
  const cur = it.timeWatched || 0;
  const ans = prompt("Time watched (minutes):", cur);
  if (ans === null) return;
  const val = parseInt(ans, 10);
  if (isNaN(val) || val < 0) return;
  it.timeWatched = val;
  it.started = true;
  saveData();
  renderHome();
}

/* --- book history sync when smanjuješ stranice --- */

function syncBookHistoryToPages(itemId, newPagesTotal) {
  let totalInHistory = 0;
  history.forEach((h) => {
    if (h.type === "book" && h.itemId === itemId && h.pages) {
      totalInHistory += h.pages;
    }
  });

  let diff = totalInHistory - newPagesTotal;
  if (diff <= 0) return;

  for (let i = history.length - 1; i >= 0 && diff > 0; i--) {
    const h = history[i];
    if (h.type === "book" && h.itemId === itemId && h.pages && h.pages > 0) {
      if (h.pages > diff) {
        h.pages -= diff;
        diff = 0;
      } else {
        diff -= h.pages;
        h.pages = 0;
      }
    }
  }
}

function updateBookPages(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.type !== "book") return;
  const cur = it.pagesRead || 0;
  const ans = prompt("To which page did you read?", cur);
  if (ans === null) return;
  const page = parseInt(ans, 10);
  if (isNaN(page) || page < 0) return;
  const total = it.totalPages || 0;
  const clamped = total ? Math.min(page, total) : page;
  const delta = clamped - cur;

  it.pagesRead = clamped;
  it.started = true;

  if (delta > 0) {
    const entry = {
      id: Date.now() + "-book",
      itemId: it.id,
      type: "book",
      title: it.title,
      pages: delta,
      timestamp: new Date().toISOString(),
    };
    history.push(entry);
  } else if (delta < 0) {
    syncBookHistoryToPages(it.id, clamped);
  }

  saveData();
  renderHome();
  renderCalendar();
}

function setRating(id, r) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  it.rating = r;
  saveData();
  renderHome();
}

/* --- remove samo iz tvoje liste, ostaje u library --- */

function removeFromList(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  it.inList = false;

  history = history.filter((h) => h.itemId !== id);
  plans = plans.filter((p) => p.itemId !== id);

  saveData();
  renderHome();
  renderCalendar();
  renderStats();
  renderProfile();
}

/* --- full delete iz library --- */

function removeItem(id) {
  items = items.filter((x) => x.id !== id);
  history = history.filter((h) => h.itemId !== id);
  plans = plans.filter((p) => p.itemId !== id);
  saveData();
  renderHome();
  renderCalendar();
  renderStats();
  renderProfile();
}

/* ---------- ADD / EDIT MODAL ---------- */

function openItemModal(item) {
  const root = document.getElementById("modalRoot");
  const isEdit = !!item;
  const typeDefault = item?.type || "movie";
  const seasons = item?.seasons || [{ season: 1, episodes: 10 }];
  const desc = item?.description || "";

  root.innerHTML = `
    <div class="overlay">
      <div class="modal" id="itemModal">
        <h2>${isEdit ? "Edit item" : "Add new item"}</h2>

        <div class="modal-row">
          <label>Type</label>
          <select id="modalType">
            <option value="movie"${typeDefault === "movie" ? " selected" : ""}>Movie</option>
            <option value="show"${typeDefault === "show" ? " selected" : ""}>TV Show</option>
            <option value="book"${typeDefault === "book" ? " selected" : ""}>Book</option>
          </select>
        </div>

        <div class="modal-row">
          <label>Title</label>
          <input id="modalTitle" value="${item ? item.title : ""}">
        </div>

        <div class="modal-row">
          <label>Image URL (optional)</label>
          <input id="modalImage" value="${item?.posterUrl || ""}">
        </div>

        <div class="modal-row">
          <label>Description (optional, 260 chars max)</label>
          <textarea id="modalDesc">${desc}</textarea>
        </div>

        <div class="modal-row book-only">
          <label>Author (optional)</label>
          <input id="modalAuthor" value="${item?.author || ""}">
        </div>

        <div class="modal-row book-only">
          <label>Total pages</label>
          <input id="modalPages" type="number" min="1" value="${item?.totalPages || 300}">
        </div>

        <div class="modal-row movie-only">
          <label>Duration (minutes, optional)</label>
          <input id="modalDuration" type="number" min="0" value="${item?.durationMinutes || ""}">
        </div>

        <div class="modal-row show-only">
          <label>Number of seasons</label>
          <input id="modalSeasonCount" type="number" min="1" value="${seasons.length}">
        </div>
        <div class="modal-row show-only" id="modalSeasonsContainer"></div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="modalCancel">Cancel</button>
          <button class="btn btn-primary" id="modalSave">${isEdit ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById("itemModal");
  const typeSel = document.getElementById("modalType");

  function updateTypeVisibility() {
    const t = typeSel.value;
    modal
      .querySelectorAll(".book-only")
      .forEach((el) => (el.style.display = t === "book" ? "block" : "none"));
    modal
      .querySelectorAll(".movie-only")
      .forEach((el) => (el.style.display = t === "movie" ? "block" : "none"));
    modal
      .querySelectorAll(".show-only")
      .forEach((el) => (el.style.display = t === "show" ? "block" : "none"));
  }

  typeSel.addEventListener("change", updateTypeVisibility);

  const seasonsContainer = document.getElementById("modalSeasonsContainer");
  function renderSeasonInputs() {
    const countInput = document.getElementById("modalSeasonCount");
    let n = parseInt(countInput.value, 10);
    if (isNaN(n) || n < 1) n = 1;

    const existing = {};
    if (item && item.type === "show" && item.seasons) {
      item.seasons.forEach((s) => (existing[s.season] = s.episodes));
    }

    seasonsContainer.innerHTML = "";
    for (let i = 1; i <= n; i++) {
      const eps = existing[i] || 10;
      seasonsContainer.innerHTML += `
        <div class="modal-row">
          <label>Season ${i} episodes</label>
          <input type="number" min="0" class="season-episodes" data-season="${i}" value="${eps}">
        </div>
      `;
    }
  }

  document
    .getElementById("modalSeasonCount")
    .addEventListener("input", renderSeasonInputs);
  renderSeasonInputs();
  updateTypeVisibility();

  document.getElementById("modalCancel").onclick = () => {
    root.innerHTML = "";
  };

  document.getElementById("modalSave").onclick = () => {
    const t = typeSel.value;
    const title = document.getElementById("modalTitle").value.trim();
    if (!title) {
      alert("Title required");
      return;
    }
    const posterUrl =
      document.getElementById("modalImage").value.trim() || null;
    let d = document.getElementById("modalDesc").value.trim();
    if (d.length > 260) d = d.slice(0, 260) + "…";

    if (isEdit) {
      const it = items.find((x) => x.id === item.id);
      if (!it) return;
      it.type = t;
      it.title = title;
      it.posterUrl = posterUrl;
      it.description = d || null;

      if (t === "book") {
        it.author =
          document.getElementById("modalAuthor").value.trim() || null;
        it.totalPages = Math.max(
          1,
          parseInt(document.getElementById("modalPages").value, 10) || 1
        );
        if ((it.pagesRead || 0) > it.totalPages) it.pagesRead = it.totalPages;
      } else if (t === "movie") {
        it.totalEpisodes = 1;
        const dur = parseInt(
          document.getElementById("modalDuration").value,
          10
        );
        it.durationMinutes = isNaN(dur) ? null : dur;
        if ((it.progress || 0) > 1) it.progress = 1;
        it.seasons = null;
      } else if (t === "show") {
        const seasonInputs = modal.querySelectorAll(".season-episodes");
        const sArr = [];
        seasonInputs.forEach((inp) => {
          const sNum = parseInt(inp.dataset.season, 10);
          const eps = parseInt(inp.value, 10) || 0;
          sArr.push({ season: sNum, episodes: eps });
        });
        it.seasons = sArr;
        it.totalEpisodes = sArr.reduce((s, x) => s + x.episodes, 0);
        if ((it.progress || 0) > it.totalEpisodes) it.progress =
          it.totalEpisodes;
      }
    } else {
      const id = Date.now();
      if (t === "book") {
        items.push({
          id,
          type: "book",
          title,
          posterUrl,
          description: d || null,
          author:
            document.getElementById("modalAuthor").value.trim() || null,
          totalPages: Math.max(
            1,
            parseInt(document.getElementById("modalPages").value, 10) || 1
          ),
          pagesRead: 0,
          started: false,
          rating: null,
          inList: false,
        });
      } else if (t === "movie") {
        const dur = parseInt(
          document.getElementById("modalDuration").value,
          10
        );
        items.push({
          id,
          type: "movie",
          title,
          posterUrl,
          description: d || null,
          totalEpisodes: 1,
          progress: 0,
          started: false,
          durationMinutes: isNaN(dur) ? null : dur,
          timeWatched: 0,
          rating: null,
          inList: false,
        });
      } else if (t === "show") {
        const seasonInputs = modal.querySelectorAll(".season-episodes");
        const sArr = [];
        seasonInputs.forEach((inp) => {
          const sNum = parseInt(inp.dataset.season, 10);
          const eps = parseInt(inp.value, 10) || 0;
          sArr.push({ season: sNum, episodes: eps });
        });
        items.push({
          id,
          type: "show",
          title,
          posterUrl,
          description: d || null,
          seasons: sArr,
          totalEpisodes: sArr.reduce((s, x) => s + x.episodes, 0),
          progress: 0,
          started: false,
          rating: null,
          inList: false,
        });
      }
    }

    saveData();
    root.innerHTML = "";
    renderHome();
    renderCalendar();
    renderStats();
    renderProfile();
  };
}

/* ---------- LIBRARY (global) ---------- */

let libraryTab = "movies";
let librarySearch = "";

function openLibraryModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal" id="libraryModal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Library</h2>
          <button class="icon-btn" id="libraryClose">✖️</button>
        </div>
        <div class="library-tabs" id="libraryTabs"></div>
        <div class="library-search"><input id="librarySearchInput" placeholder="Search by title..."></div>
        <div id="libraryList" style="max-height:320px;overflow:auto;margin-bottom:6px;"></div>
        <div class="library-footer">
          <button class="btn btn-info" id="libraryAddNew">Add new</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("libraryClose").onclick = () => {
    root.innerHTML = "";
  };
  document.getElementById("libraryAddNew").onclick = () => {
    root.innerHTML = "";
    openItemModal(null);
  };

  const tabsEl = document.getElementById("libraryTabs");
  tabsEl.innerHTML = `
    <button data-tab="movies" class="${libraryTab === "movies" ? "active" : ""}">Movies</button>
    <button data-tab="shows" class="${libraryTab === "shows" ? "active" : ""}">TV Shows</button>
    <button data-tab="books" class="${libraryTab === "books" ? "active" : ""}">Books</button>
  `;
  tabsEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      libraryTab = btn.dataset.tab;
      openLibraryModal();
    });
  });

  const sInput = document.getElementById("librarySearchInput");
  sInput.value = librarySearch;
  sInput.addEventListener("input", () => {
    librarySearch = sInput.value.toLowerCase();
    renderLibraryList();
  });

  renderLibraryList();
}

function renderLibraryList() {
  const listEl = document.getElementById("libraryList");
  if (!listEl) return;

  let list = items.filter((it) => {
    if (libraryTab === "movies" && it.type !== "movie") return false;
    if (libraryTab === "shows" && it.type !== "show") return false;
    if (libraryTab === "books" && it.type !== "book") return false;
    if (librarySearch && !it.title.toLowerCase().includes(librarySearch))
      return false;
    return true;
  });

  if (!list.length) {
    listEl.innerHTML = `<p style="font-size:13px;opacity:0.7;">No items in this category.</p>`;
    return;
  }

  listEl.innerHTML = list
    .map((it) => {
      const inList = it.inList !== false;
      return `
      <div class="library-item" data-id="${it.id}">
        <div class="library-left">
          <div class="library-mini-poster">
            ${
              it.posterUrl ? `<img src="${it.posterUrl}">` : "No img"
            }
          </div>
          <div>
            <div>${it.title}</div>
            <div style="font-size:11px;opacity:0.7;">
              ${
                it.type === "movie"
                  ? "Movie"
                  : it.type === "show"
                  ? "TV Show"
                  : "Book"
              }${inList ? " · In your list" : ""}
            </div>
          </div>
        </div>
        <div class="library-right">
          ${
            inList
              ? `<button class="btn-secondary lib-remove-from-list">Remove from list</button>`
              : `<button class="btn-primary lib-add-to-list">Add to your list</button>`
          }
          <button class="btn-info lib-edit">Edit</button>
          <button class="btn-danger lib-remove">Remove</button>
        </div>
      </div>
    `;
    })
    .join("");

  list.forEach((it) => {
    const row = listEl.querySelector(
      `.library-item[data-id="${it.id}"]`
    );
    const inList = it.inList !== false;

    if (inList) {
      row
        .querySelector(".lib-remove-from-list")
        .addEventListener("click", () => {
          it.inList = false;
          saveData();
          renderHome();
          renderLibraryList();
          renderStats();
          renderProfile();
        });
    } else {
      row
        .querySelector(".lib-add-to-list")
        .addEventListener("click", () => {
          it.inList = true;
          saveData();
          renderHome();
          renderLibraryList();
          renderStats();
          renderProfile();
        });
    }

    row.querySelector(".lib-edit").addEventListener("click", () => {
      document.getElementById("modalRoot").innerHTML = "";
      openItemModal(it);
    });

    row.querySelector(".lib-remove").addEventListener("click", () => {
      if (!confirm("Remove completely from library?")) return;
      removeItem(it.id);
      openLibraryModal();
    });
  });
}

/* ---------- CALENDAR ---------- */

let calendarCurrent = new Date();

function buildMonthMatrix(d) {
  const y = d.getFullYear(),
    m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const firstWeekday = (first.getDay() + 6) % 7;
  const days = last.getDate();
  const weeks = [];
  let week = [];

  for (let i = 0; i < firstWeekday; i++) week.push({ inMonth: false });

  for (let day = 1; day <= days; day++) {
    const dk = dateKeyFromDate(new Date(y, m, day));
    week.push({ inMonth: true, day, dk });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  if (week.length) {
    while (week.length < 7) week.push({ inMonth: false });
    weeks.push(week);
  }

  return weeks;
}

function groupCalendarData() {
  const g = {};
  history.forEach((h) => {
    const dk = h.timestamp?.slice(0, 10);
    if (!dk) return;
    if (!g[dk]) g[dk] = { watch: [], books: [], plans: [] };

    if (h.type === "movie") {
      g[dk].watch.push({
        type: "movie",
        title: h.title,
        label: "Movie watched",
      });
    } else if (h.type === "show") {
      const lbl =
        h.season && h.episode
          ? `Episode watched – S${h.season}E${h.episode}`
          : "Episode watched";
      g[dk].watch.push({
        type: "show",
        title: h.title,
        label: lbl,
      });
    } else if (h.type === "book") {
      const inc = h.pages || 0;
      if (inc <= 0) return;
      let existing = g[dk].books.find(
        (b) => b.itemId === h.itemId
      );
      if (!existing) {
        existing = {
          type: "book",
          itemId: h.itemId,
          title: h.title,
          pages: 0,
          label: "",
        };
        g[dk].books.push(existing);
      }
      existing.pages += inc;
      existing.label = `Read ${existing.pages} pages`;
    }
  });

  plans.forEach((p) => {
    if (!g[p.date]) g[p.date] = { watch: [], books: [], plans: [] };

    let label = "Planned";
    if (p.type === "show" && p.episodesPlanned) {
      label = `Plan ${p.episodesPlanned} episodes`;
    } else if (p.type === "book" && p.pagesPlanned) {
      label = `Plan ${p.pagesPlanned} pages`;
    } else if (p.type === "movie") {
      label = "Planned movie";
    }

    g[p.date].plans.push({
      type: p.type,
      title: p.title,
      label,
      planId: p.id,
    });
  });

  return g;
}

function calcBookStreak() {
  const set = new Set(
    history
      .filter((h) => h.type === "book" && (h.pages || 0) > 0)
      .map((h) => h.timestamp.slice(0, 10))
  );
  if (!set.size) return 0;
  let s = 0;
  let d = new Date();
  while (true) {
    const dk = dateKeyFromDate(d);
    if (!set.has(dk)) break;
    s++;
    d.setDate(d.getDate() - 1);
  }
  return s;
}

function calcWatchStreakWeekly() {
  const set = new Set(
    history
      .filter((h) => h.type === "movie" || h.type === "show")
      .map((h) => h.timestamp.slice(0, 10))
  );
  if (!set.size) return 0;
  let s = 0;
  let ref = new Date();
  while (true) {
    const monday = new Date(ref);
    const day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day);
    let has = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dk = dateKeyFromDate(d);
      if (set.has(dk)) {
        has = true;
        break;
      }
    }
    if (!has) break;
    s++;
    ref.setDate(ref.getDate() - 7);
  }
  return s;
}

function renderDayCell(day, g) {
  if (!day.inMonth) return `<div class="day-cell outside"></div>`;
  const d = g[day.dk] || { watch: [], books: [], plans: [] };
  const lines = [
    ...d.watch.map((x) => ({
      emoji: "📺",
      kind: "watch",
      ...x,
    })),
    ...d.books.map((x) => ({
      emoji: "📗",
      kind: "book",
      ...x,
    })),
    ...d.plans.map((x) => ({
      emoji: "📝",
      kind: "plan",
      ...x,
    })),
  ];

  let htmlLines = "";
  const limit = 3;
  lines.slice(0, limit).forEach((x) => {
    htmlLines += `
      <div class="day-entry-line">
        <span>${x.emoji}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${x.label}: ${x.title}
        </span>
      </div>
    `;
  });
  const extra = lines.length - limit;
  const extraHtml =
    extra > 0 ? `<div class="day-extra">+${extra} more…</div>` : "";

  return `
    <div class="day-cell" data-date="${day.dk}">
      <div class="day-number">${day.day}</div>
      <div class="day-entries">${htmlLines}${extraHtml}</div>
    </div>
  `;
}

function renderCalendar() {
  const page = document.getElementById("calendarPage");
  const matrix = buildMonthMatrix(calendarCurrent);
  const g = groupCalendarData();
  const monthName = calendarCurrent.toLocaleString("default", {
    month: "long",
  });
  const year = calendarCurrent.getFullYear();
  const watchStreak = calcWatchStreakWeekly();
  const bookStreak = calcBookStreak();

  let grid = `<div class="calendar-grid">
    ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map((d) => `<div class="weekday">${d}</div>`)
      .join("")}
  `;
  matrix.forEach((week) => {
    week.forEach((day) => {
      grid += renderDayCell(day, g);
    });
  });
  grid += "</div>";

  page.innerHTML = `
    <div>
      <div class="streak-bar">
        <div class="streak-pill">
          <span>📺</span><span>Watch streak (weeks):</span><strong>${watchStreak}</strong>
        </div>
        <div class="streak-pill">
          <span>📗</span><span>Book streak (days):</span><strong>${bookStreak}</strong>
        </div>
      </div>
      <div class="calendar-header">
        <button class="btn btn-secondary" id="calPrev">&lt;</button>
        <div style="font-weight:600;font-size:16px;">${monthName} ${year}</div>
        <button class="btn btn-secondary" id="calNext">&gt;</button>
      </div>
      ${grid}
    </div>
 `;

  document.getElementById("calPrev").onclick = () => {
    calendarCurrent = new Date(
      calendarCurrent.getFullYear(),
      calendarCurrent.getMonth() - 1,
      1
    );
    renderCalendar();
  };
  document.getElementById("calNext").onclick = () => {
    calendarCurrent = new Date(
      calendarCurrent.getFullYear(),
      calendarCurrent.getMonth() + 1,
      1
    );
    renderCalendar();
  };

  page.querySelectorAll(".day-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () =>
      openDayPopup(cell.dataset.date)
    );
  });
}

function openDayPopup(dateKey) {
  const root = document.getElementById("dayRoot");
  const g = groupCalendarData();
  const d = g[dateKey] || { watch: [], books: [], plans: [] };
  const list = [
    ...d.watch.map((x) => ({
      emoji: "📺",
      kind: "watch",
      ...x,
    })),
    ...d.books.map((x) => ({
      emoji: "📗",
      kind: "book",
      ...x,
    })),
    ...d.plans.map((x) => ({
      emoji: "📝",
      kind: "plan",
      ...x,
    })),
  ];

  let body = "";
  if (!list.length) {
    body = `<p style="font-size:13px;opacity:0.7;">No activity yet.</p>`;
  } else {
    body = list
      .map(
        (x) => `
      <div style="display:flex;gap:6px;font-size:13px;border-bottom:1px solid #222;padding:3px 0;align-items:flex-start;">
        <span>${x.emoji}</span>
        <div style="flex:1;">
          <div style="font-weight:600;">${x.title}</div>
          <div style="font-size:11px;opacity:0.75;">${x.label}</div>
        </div>
        ${
          x.kind === "plan"
            ? `<button class="remove-plan" data-plan-id="${x.planId}"
                 style="font-size:10px;padding:2px 6px;border-radius:999px;border:none;background:#ef4444;color:#fff;">
                 Remove
               </button>`
            : ""
        }
      </div>
    `
      )
      .join("");
  }

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Day ${dateKey}</h2>
          <button class="icon-btn" id="dayClose">✖️</button>
        </div>
        <div style="max-height:260px;overflow:auto;margin-bottom:8px;">
          ${body}
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="dayAddPlan">Add plan</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("dayClose").onclick = () => {
    root.innerHTML = "";
  };
  document.getElementById("dayAddPlan").onclick = () =>
    openAddPlanPopup(dateKey);

  root.querySelectorAll(".remove-plan").forEach((btn) => {
    const planId = Number(btn.dataset.planId);
    btn.addEventListener("click", () => {
      plans = plans.filter((p) => p.id !== planId);
      saveData();
      openDayPopup(dateKey);
      renderCalendar();
    });
  });
}

function openAddPlanPopup(dateKey) {
  const root = document.getElementById("planRoot");

  const candidates = items.filter((it) => {
    const st = getItemStatus(it);
    return (st === "unwatched" || st === "inprogress") && it.inList !== false;
  });

  let listHtml = "";
  if (!candidates.length) {
    listHtml = `<p style="font-size:13px;opacity:0.7;">No items available (only Unwatched / In progress / To be read can be planned).</p>`;
  } else {
    listHtml = candidates
      .map(
        (it) => `
      <button class="plan-btn" data-id="${it.id}"
        style="width:100%;text-align:left;padding:6px 8px;border-radius:10px;border:1px solid #333;background:#1f1f1f;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:600;">${it.title}</div>
        <div style="font-size:11px;opacity:0.7;">
          ${
            it.type === "book"
              ? "Book"
              : it.type === "movie"
              ? "Movie"
              : "TV Show"
          } · ${getItemStatus(it)}
        </div>
      </button>
    `
      )
      .join("");
  }

  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Add plan for ${dateKey}</h2>
          <button class="icon-btn" id="planClose">✖️</button>
        </div>
        <div style="max-height:260px;overflow:auto;">
          ${listHtml}
        </div>
      </div>
    </div>
  `;

  document.getElementById("planClose").onclick = () => {
    root.innerHTML = "";
  };

  root.querySelectorAll(".plan-btn").forEach((btn) => {
    const id = Number(btn.dataset.id);
    btn.addEventListener("click", () => {
      const it = items.find((x) => x.id === id);
      if (!it) return;

      if (it.type === "show") {
        const total = it.totalEpisodes || 0;
        const watched = it.progress || 0;
        const remaining = Math.max(0, total - watched);
        if (!remaining) {
          alert("No episodes left to plan.");
          return;
        }
        const pos = getShowPos(it);
        const startLabel =
          pos && !pos.completed
            ? `S${pos.season}E${pos.episode}`
            : "next episode";
        const ans = prompt(
          `How many episodes do you plan to watch (starting from ${startLabel})? Available: ${remaining}`,
          "1"
        );
        if (ans === null) return;
        const n = parseInt(ans, 10);
        if (isNaN(n) || n < 1 || n > remaining) {
          alert("Invalid number of episodes.");
          return;
        }
        plans.push({
          id: Date.now(),
          date: dateKey,
          itemId: it.id,
          title: it.title,
          type: it.type,
          episodesPlanned: n,
        });
      } else if (it.type === "book") {
        const ans = prompt(
          "How many pages do you plan to read?",
          "20"
        );
        if (ans === null) return;
        const n = parseInt(ans, 10);
        if (isNaN(n) || n < 1) {
          alert("Invalid number of pages.");
          return;
        }
        plans.push({
          id: Date.now(),
          date: dateKey,
          itemId: it.id,
          title: it.title,
          type: it.type,
          pagesPlanned: n,
        });
      } else if (it.type === "movie") {
        plans.push({
          id: Date.now(),
          date: dateKey,
          itemId: it.id,
          title: it.title,
          type: it.type,
        });
      }

      saveData();
      root.innerHTML = "";
      document.getElementById("dayRoot").innerHTML = "";
      renderCalendar();
    });
  });
}

/* ---------- STATS ---------- */

function renderStats() {
  const page = document.getElementById("statsPage");
  const movies = items.filter(
    (i) => i.type === "movie" && i.inList !== false
  );
  const shows = items.filter(
    (i) => i.type === "show" && i.inList !== false
  );
  const books = items.filter(
    (i) => i.type === "book" && i.inList !== false
  );

  const moviesWatched = movies.filter(
    (i) => getItemStatus(i) === "watched"
  ).length;
  const showsCompleted = shows.filter(
    (i) => getItemStatus(i) === "watched"
  ).length;

  const totalEpisodes = shows.reduce(
    (s, it) => s + (it.totalEpisodes || 0),
    0
  );
  const watchedEpisodes = shows.reduce(
    (s, it) =>
      s +
      Math.min(it.progress || 0, it.totalEpisodes || 0),
    0
  );

  const booksFinished = books.filter(
    (i) => getItemStatus(i) === "watched"
  ).length;
  const totalPages = books.reduce(
    (s, it) => s + (it.totalPages || 0),
    0
  );
  const pagesRead = books.reduce(
    (s, it) => s + (it.pagesRead || 0),
    0
  );

  page.innerHTML = `
    <div>
      <div class="card"><div style="flex:1;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:4px;">Movies</h3>
        <p>Total movies: ${movies.length}</p>
        <p>Watched movies: ${moviesWatched}</p>
      </div></div>
      <div class="card"><div style="flex:1;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:4px;">TV Shows</h3>
        <p>Total shows: ${shows.length}</p>
        <p>Completed shows: ${showsCompleted}</p>
        <p>Total episodes: ${totalEpisodes}</p>
        <p>Episodes watched: ${watchedEpisodes}</p>
      </div></div>
      <div class="card"><div style="flex:1;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:4px;">Books</h3>
        <p>Total books: ${books.length}</p>
        <p>Finished books: ${booksFinished}</p>
        <p>Total pages: ${totalPages}</p>
        <p>Pages read: ${pagesRead}</p>
      </div></div>
    </div>
  `;
}

/* ---------- PROFILE + ACCOUNTS ---------- */

function updateHeaderNickname() {
  const btn = document.getElementById("profileBtn");
  if (!btn) return;

  btn.innerHTML = "👤";

  let label = document.getElementById("profileNickLabel");
  if (!label) {
    label = document.createElement("span");
    label.id = "profileNickLabel";
    label.style.marginRight = "8px";
    label.style.fontSize = "13px";
    label.style.color = "#ffffff";
    label.style.opacity = "0.9";

    const header = btn.parentElement;
    if (header) {
      header.insertBefore(label, btn);
    }
  }

  const nick = getCurrentUserNick();
  if (nick) {
    label.textContent = nick;
    label.style.display = "inline-block";
  } else {
    label.textContent = "";
    label.style.display = "none";
  }
}

function getAccounts() {
  try {
    const raw = localStorage.getItem("trackflix_accounts");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // osiguraj da svaki account ima friends / requests arraye
    return parsed.map(acc => ({
      ...acc,
      friends: Array.isArray(acc.friends) ? acc.friends : [],
      requests: Array.isArray(acc.requests) ? acc.requests : []
    }));
  } catch {
    return [];
  }
}

function saveAccounts(arr) {
  localStorage.setItem("trackflix_accounts", JSON.stringify(arr));
}

function sendFriendRequest(targetNick) {
  const currentNick = getCurrentUserNick();
  if (!currentNick) {
    alert("You need to log in or register.");
    return;
  }

  const accounts = getAccounts();
  const me = accounts.find(a => a.nickname === currentNick);
  const other = accounts.find(a => a.nickname === targetNick);
  if (!me || !other || me.nickname === other.nickname) return;

  if (me.friends.includes(other.nickname) || other.friends.includes(me.nickname)) {
    alert("You are already friends.");
    return;
  }
  if (other.requests.includes(me.nickname)) {
    alert("Request already sent.");
    return;
  }

  other.requests.push(me.nickname);
  saveAccounts(accounts);
  alert("Friend request sent ✅");
}

function openAddFriendsPopup() {
  const currentNick = getCurrentUserNick();
  if (!currentNick) {
    alert("You need to log in or register.");
    return;
  }

  const root = document.getElementById("settingsRoot");
  const accounts = getAccounts();
  const me = accounts.find(a => a.nickname === currentNick);
  if (!me) {
    alert("Something went wrong with account data.");
    return;
  }

  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:360px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Add friends</h2>
          <button class="icon-btn" id="addFriendsClose">✖️</button>
        </div>
        <div class="modal-row">
          <label>Search users</label>
          <input id="friendsSearchInput" placeholder="Search by nickname...">
        </div>
        <div id="friendsSearchList" style="max-height:260px;overflow:auto;"></div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  document.getElementById("addFriendsClose").onclick = close;

  const input = document.getElementById("friendsSearchInput");
  const listEl = document.getElementById("friendsSearchList");

  function renderList() {
    const q = (input.value || "").toLowerCase();
    const all = getAccounts();
    const me2 = all.find(a => a.nickname === currentNick);

    const filtered = all.filter(a => {
      if (a.nickname === currentNick) return false;
      if (q && !a.nickname.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!filtered.length) {
      listEl.innerHTML = `<p style="font-size:13px;opacity:0.7;">No users found.</p>`;
      return;
    }

    listEl.innerHTML = filtered.map(a => {
      const isFriend = me2.friends.includes(a.nickname) || a.friends.includes(currentNick);
      const requestSent = a.requests.includes(currentNick);

      let rightHtml = "";
      if (isFriend) {
        rightHtml = `<span style="font-size:11px;opacity:0.7;">Friend</span>`;
      } else if (requestSent) {
        rightHtml = `<span style="font-size:11px;opacity:0.7;">Request sent</span>`;
      } else {
        rightHtml = `<button class="btn btn-primary friend-add-btn" data-nick="${a.nickname}" style="padding:4px 8px;font-size:11px;">Add</button>`;
      }

      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:10px;background:#1f1f1f;margin-bottom:6px;">
          <div style="font-size:13px;font-weight:600;">${a.nickname}</div>
          ${rightHtml}
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".friend-add-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const nick = btn.dataset.nick;
        sendFriendRequest(nick);
        renderList(); // refresh status (Request sent)
      });
    });
  }

  input.addEventListener("input", renderList);
  renderList();
}

function openNotificationsPopup() {
  const currentNick = getCurrentUserNick();
  if (!currentNick) {
    alert("You need to log in or register.");
    return;
  }

  const root = document.getElementById("settingsRoot");
  const accounts = getAccounts();
  const me = accounts.find(a => a.nickname === currentNick);
  if (!me) {
    alert("Something went wrong with account data.");
    return;
  }

  const requests = me.requests || [];

  let body = "";
  if (!requests.length) {
    body = `<p style="font-size:13px;opacity:0.7;">No friend requests.</p>`;
  } else {
    body = requests.map(nick => `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;">
        <span>${nick}</span>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-primary notif-accept" data-nick="${nick}" style="padding:4px 8px;font-size:11px;">Accept</button>
          <button class="btn btn-secondary notif-ignore" data-nick="${nick}" style="padding:4px 8px;font-size:11px;">Ignore</button>
        </div>
      </div>
    `).join("");
  }

  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Notifications</h2>
          <button class="icon-btn" id="notifClose">✖️</button>
        </div>
        <div style="max-height:260px;overflow:auto;">
          ${body}
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  document.getElementById("notifClose").onclick = close;

  function handleAccept(fromNick) {
    const accs = getAccounts();
    const meA = accs.find(a => a.nickname === currentNick);
    const other = accs.find(a => a.nickname === fromNick);
    if (!meA || !other) return;

    meA.requests = (meA.requests || []).filter(n => n !== fromNick);
    if (!meA.friends.includes(fromNick)) meA.friends.push(fromNick);
    if (!other.friends.includes(currentNick)) other.friends.push(currentNick);

    saveAccounts(accs);
    openNotificationsPopup();
  }

  function handleIgnore(fromNick) {
    const accs = getAccounts();
    const meA = accs.find(a => a.nickname === currentNick);
    if (!meA) return;
    meA.requests = (meA.requests || []).filter(n => n !== fromNick);
    saveAccounts(accs);
    openNotificationsPopup();
  }

  root.querySelectorAll(".notif-accept").forEach(btn => {
    btn.addEventListener("click", () => handleAccept(btn.dataset.nick));
  });
  root.querySelectorAll(".notif-ignore").forEach(btn => {
    btn.addEventListener("click", () => handleIgnore(btn.dataset.nick));
  });
}

function openFriendsPopup() {
  const currentNick = getCurrentUserNick();
  if (!currentNick) {
    alert("You need to log in or register.");
    return;
  }

  const root = document.getElementById("settingsRoot");
  const accounts = getAccounts();
  const me = accounts.find(a => a.nickname === currentNick);
  if (!me) {
    alert("Something went wrong with account data.");
    return;
  }

  const friends = me.friends || [];

  let body = "";
  if (!friends.length) {
    body = `<p style="font-size:13px;opacity:0.7;">You don't have any friends yet.</p>`;
  } else {
    body = friends.map(nick => `
      <button class="btn btn-secondary friend-profile-btn" data-nick="${nick}"
        style="width:100%;text-align:left;margin-bottom:6px;padding:6px 8px;border-radius:10px;">
        ${nick}
      </button>
    `).join("");
  }

  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Friends</h2>
          <button class="icon-btn" id="friendsClose">✖️</button>
        </div>
        <div style="max-height:260px;overflow:auto;">
          ${body}
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  document.getElementById("friendsClose").onclick = close;

  root.querySelectorAll(".friend-profile-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const nick = btn.dataset.nick;
      root.innerHTML = "";
      openFriendProfile(nick);
    });
  });
}

function openSimpleList(title, arr) {
  const root = document.getElementById("settingsRoot");
  const body = arr.length
    ? arr.map((t) => `<p>${t}</p>`).join("")
    : `<p style="opacity:0.7;">No items.</p>`;
  root.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>${title}</h2>
          <button class="icon-btn" id="simpleClose">✖️</button>
        </div>
        <div class="simple-list">${body}</div>
      </div>
    </div>
  `;
  document.getElementById("simpleClose").onclick = () => {
    root.innerHTML = "";
  };
}

function openRegisterPopup() {
  const root = document.getElementById("settingsRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Register</h2>
          <button class="icon-btn" id="regClose">✖️</button>
        </div>
        <div class="modal-row">
          <label>Email</label>
          <input id="regEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="modal-row">
          <label>Nickname</label>
          <input id="regNick" placeholder="Your nickname">
        </div>
        <div class="modal-row">
          <label>Password</label>
          <input id="regPass" type="password" placeholder="Password">
          <p style="font-size:11px;opacity:0.7;margin-top:4px;">
            Ne koristi lozinku koju inače koristiš.
          </p>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="regCancel">Cancel</button>
          <button class="btn btn-primary" id="regSubmit">Register</button>
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  document.getElementById("regClose").onclick = close;
  document.getElementById("regCancel").onclick = close;

  document.getElementById("regSubmit").onclick = () => {
    const email = (document.getElementById("regEmail").value || "").trim();
    const nick  = (document.getElementById("regNick").value  || "").trim();
    const pass  = (document.getElementById("regPass").value  || "").trim();

    if (!email || !nick || !pass) {
      alert("Please fill all fields.");
      return;
    }

    const accounts = getAccounts();
    if (accounts.some(a => a.email === email || a.nickname === nick)) {
      alert("User with this email or nickname already exists.");
      return;
    }

    accounts.push({ email, nickname: nick, password: pass, friends: [], requests: [] });
    saveAccounts(accounts);

    localStorage.setItem("trackflix_current_user", nick);
    localStorage.setItem("trackflix_profile_name", nick);

    updateHeaderNickname();
    // učitaj podatke za NOVOG usera i rerenderaj sve stranice
    loadData();
    renderHome();
    renderCalendar();
    renderStats();
    renderProfile();

    alert("Registracija uspješna ✅");

    close();
  };
}

function openLoginPopup() {
  const root = document.getElementById("settingsRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Login</h2>
          <button class="icon-btn" id="logClose">✖️</button>
        </div>
        <div class="modal-row">
          <label>Email or nickname</label>
          <input id="logUser" placeholder="Email or nickname">
        </div>
        <div class="modal-row">
          <label>Password</label>
          <input id="logPass" type="password" placeholder="Password">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="logCancel">Cancel</button>
          <button class="btn btn-primary" id="logSubmit">Login</button>
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  document.getElementById("logClose").onclick = close;
  document.getElementById("logCancel").onclick = close;

  document.getElementById("logSubmit").onclick = () => {
    const user = (document.getElementById("logUser").value || "").trim();
    const pass = (document.getElementById("logPass").value || "").trim();
    if (!user || !pass) {
      alert("Please fill all fields.");
      return;
    }

    const accounts = getAccounts();
    const found = accounts.find(
      a =>
        (a.email === user || a.nickname === user) &&
        a.password === pass
    );

    if (!found) {
      alert("Invalid credentials.");
      return;
    }

    localStorage.setItem("trackflix_current_user", found.nickname);
    localStorage.setItem("trackflix_profile_name", found.nickname);

    updateHeaderNickname();
    // učitaj podatke za PRIJAVLJENOG usera i rerenderaj sve stranice
    loadData();
    renderHome();
    renderCalendar();
    renderStats();
    renderProfile();

    alert("Prijava uspješna ✅");

    close();
  };
}

function renderProfile() {
  const page = document.getElementById("profilePage");
  const currentNick = getCurrentUserNick();

  if (!currentNick) {
    page.innerHTML = `
      <div>
        <p style="font-size:14px;opacity:0.8;margin-bottom:12px;">
          You are not logged in. Please register or log in to see your stats.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="profileLogin">Login</button>
          <button class="btn btn-info" id="profileRegister">Register</button>
        </div>
      </div>
    `;

    document.getElementById("profileLogin").onclick = openLoginPopup;
    document.getElementById("profileRegister").onclick = openRegisterPopup;

    updateHeaderNickname();
    return;
  }

  const moviesWatchedTitles = items
    .filter(i => i.type === "movie" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);
  const showsWatchedTitles = items
    .filter(i => i.type === "show" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);
  const booksFinishedTitles = items
    .filter(i => i.type === "book" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);

  const moviesUnwatchedTitles = items
    .filter(i => i.type === "movie" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);
  const showsUnwatchedTitles = items
    .filter(i => i.type === "show" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);
  const booksTbrTitles = items
    .filter(i => i.type === "book" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);

  const avatarUrl = localStorage.getItem("trackflix_profile_avatar") || "";
  const avatarContent = avatarUrl
    ? `<img src="${avatarUrl}" alt="Avatar" style="width:44px;height:44px;border-radius:999px;object-fit:cover;">`
    : currentNick.charAt(0).toUpperCase();

  page.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="width:44px;height:44px;border-radius:999px;background:#2563eb;
                    display:flex;align-items:center;justify-content:center;
                    font-weight:700;font-size:20px;overflow:hidden;">
          ${avatarContent}
        </div>
        <div>
        <div style="font-weight:600;font-size:15px;">${currentNick}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
            <button class="btn btn-secondary" id="editProfileAvatar" style="padding:4px 8px;font-size:11px;">
                Edit avatar
            </button>
            <button class="btn btn-info" id="profileFriends" style="padding:4px 8px;font-size:11px;">
                Friends
            </button>
            <button class="btn btn-secondary" id="profileAddFriends" style="padding:4px 8px;font-size:11px;">
                Add friends
            </button>
        </div>

          </div>
        </div>
      </div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Watched Movies (${moviesWatchedTitles.length})</h3>
        <button class="btn btn-info" id="profMovies">Check movies</button>
      </div></div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Completed TV Shows (${showsWatchedTitles.length})</h3>
        <button class="btn btn-info" id="profShows">Check shows</button>
      </div></div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Finished Books (${booksFinishedTitles.length})</h3>
        <button class="btn btn-info" id="profBooks">Check books</button>
      </div></div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Unwatched Movies (${moviesUnwatchedTitles.length})</h3>
        <button class="btn btn-info" id="profMoviesUn">Check list</button>
      </div></div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Unwatched TV Shows (${showsUnwatchedTitles.length})</h3>
        <button class="btn btn-info" id="profShowsUn">Check list</button>
      </div></div>

      <div class="card"><div style="flex:1;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">To be read (Books) (${booksTbrTitles.length})</h3>
        <button class="btn btn-info" id="profBooksTbr">Check list</button>
      </div></div>

      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-danger" id="profileLogout">Logout</button>
      </div>
    </div>
  `;

  document.getElementById("editProfileAvatar").onclick = () => {
    const current = localStorage.getItem("trackflix_profile_avatar") || "";
    const url = prompt("Avatar image URL (leave empty to reset):", current);
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      localStorage.removeItem("trackflix_profile_avatar");
    } else {
      localStorage.setItem("trackflix_profile_avatar", trimmed);
    }
    renderProfile();
  };

  document.getElementById("profMovies").onclick    = () => openSimpleList("Watched movies", moviesWatchedTitles);
  document.getElementById("profShows").onclick     = () => openSimpleList("Completed TV shows", showsWatchedTitles);
  document.getElementById("profBooks").onclick     = () => openSimpleList("Finished books", booksFinishedTitles);
  document.getElementById("profMoviesUn").onclick  = () => openSimpleList("Unwatched movies", moviesUnwatchedTitles);
  document.getElementById("profileFriends").onclick = openFriendsPopup;
  document.getElementById("profileAddFriends").onclick = openAddFriendsPopup;
  document.getElementById("profShowsUn").onclick   = () => openSimpleList("Unwatched TV shows", showsUnwatchedTitles);
  document.getElementById("profBooksTbr").onclick  = () => openSimpleList("To be read (books)", booksTbrTitles);

  document.getElementById("profileLogout").onclick = () => {
    localStorage.removeItem("trackflix_current_user");
    localStorage.removeItem("trackflix_profile_name");
    updateHeaderNickname();
    renderProfile();
  };

  updateHeaderNickname();
}

function openFriendProfile(friendNick) {
  if (!friendNick) return;

  const snap = getUserSnapshotByNick(friendNick);
  const friendItems = snap.items;

  const moviesWatchedTitles = friendItems
    .filter(i => i.type === "movie" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);

  const showsWatchedTitles = friendItems
    .filter(i => i.type === "show" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);

  const booksFinishedTitles = friendItems
    .filter(i => i.type === "book" && i.inList !== false && getItemStatus(i) === "watched")
    .map(i => i.title);

  const moviesUnwatchedTitles = friendItems
    .filter(i => i.type === "movie" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);

  const showsUnwatchedTitles = friendItems
    .filter(i => i.type === "show" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);

  const booksTbrTitles = friendItems
    .filter(i => i.type === "book" && i.inList !== false && getItemStatus(i) === "unwatched")
    .map(i => i.title);

  // za sada avatar = prvo slovo nicka (da ne diramo globalni trackflix_profile_avatar)
  const avatarContent = friendNick.charAt(0).toUpperCase();

  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:360px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2 style="font-size:17px;">${friendNick}</h2>
          <button class="icon-btn" id="friendProfileClose">✖️</button>
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:44px;height:44px;border-radius:999px;background:#2563eb;
                      display:flex;align-items:center;justify-content:center;
                      font-weight:700;font-size:20px;overflow:hidden;">
            ${avatarContent}
          </div>
          <div style="font-size:13px;opacity:0.8;">
            Friend profile
          </div>
        </div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Watched Movies (${moviesWatchedTitles.length})</h3>
          <button class="btn btn-info" id="friendProfMovies">Check movies</button>
        </div></div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Completed TV Shows (${showsWatchedTitles.length})</h3>
          <button class="btn btn-info" id="friendProfShows">Check shows</button>
        </div></div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Finished Books (${booksFinishedTitles.length})</h3>
          <button class="btn btn-info" id="friendProfBooks">Check books</button>
        </div></div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Unwatched Movies (${moviesUnwatchedTitles.length})</h3>
          <button class="btn btn-info" id="friendProfMoviesUn">Check list</button>
        </div></div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">Unwatched TV Shows (${showsUnwatchedTitles.length})</h3>
          <button class="btn btn-info" id="friendProfShowsUn">Check list</button>
        </div></div>

        <div class="card"><div style="flex:1;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">To be read (Books) (${booksTbrTitles.length})</h3>
          <button class="btn btn-info" id="friendProfBooksTbr">Check list</button>
        </div></div>
      </div>
    </div>
  `;

  document.getElementById("friendProfileClose").onclick = () => {
    root.innerHTML = "";
  };

  document.getElementById("friendProfMovies").onclick   = () => openSimpleList(`Watched movies – ${friendNick}`,       moviesWatchedTitles);
  document.getElementById("friendProfShows").onclick    = () => openSimpleList(`Completed TV shows – ${friendNick}`,   showsWatchedTitles);
  document.getElementById("friendProfBooks").onclick    = () => openSimpleList(`Finished books – ${friendNick}`,       booksFinishedTitles);
  document.getElementById("friendProfMoviesUn").onclick = () => openSimpleList(`Unwatched movies – ${friendNick}`,     moviesUnwatchedTitles);
  document.getElementById("friendProfShowsUn").onclick  = () => openSimpleList(`Unwatched TV shows – ${friendNick}`,   showsUnwatchedTitles);
  document.getElementById("friendProfBooksTbr").onclick = () => openSimpleList(`To be read – ${friendNick}`,           booksTbrTitles);
}

/* ---------- SETTINGS ---------- */

document.getElementById("settingsBtn").onclick = () => {
  const root = document.getElementById("settingsRoot");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:320px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h2>Settings</h2>
          <button class="icon-btn" id="settingsClose">✖️</button>
        </div>
        <button class="btn btn-info" id="exportJson">Export as JSON</button>
      </div>
    </div>
  `;
  document.getElementById("settingsClose").onclick = () => {
    root.innerHTML = "";
  };
  document.getElementById("exportJson").onclick = () => {
    const blob = new Blob(
      [JSON.stringify({ items, history, plans }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trackflix-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
};

/* ---------- NAV + PROFILE BTN + FAB ---------- */

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const pageId = btn.dataset.page;
    document
      .querySelectorAll(".page")
      .forEach((p) => p.classList.remove("active"));
    document.getElementById(pageId).classList.add("active");
    document
      .querySelectorAll(".nav-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    if (pageId === "homePage") renderHome();
    if (pageId === "calendarPage") renderCalendar();
    if (pageId === "statsPage") renderStats();
  });
});

document.getElementById("profileBtn").onclick = () => {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("profilePage").classList.add("active");
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));
  renderProfile();
};

const notifBtn = document.getElementById("notificationsBtn");
if (notifBtn) {
  notifBtn.onclick = () => {
    if (!getCurrentUserNick()) {
      alert("You need to log in or register.");
      return;
    }
    openNotificationsPopup();
  };
}

// PLUS / FAB – samo za logirane
document.getElementById("fabBtn").onclick = () => {
  if (!getCurrentUserNick()) {
    alert("You need to log in or register.");
    return;
  }
  openLibraryModal();
};

/* ---------- INIT ---------- */

(async function initTrackflix() {
  await loadData();
  renderHome();
  renderCalendar();
  renderStats();
  renderProfile();
  updateHeaderNickname();
})();

