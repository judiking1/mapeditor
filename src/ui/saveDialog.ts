// Lightweight modal: lists IndexedDB save slots with Save/Load/Delete and
// hooks for file Import/Export. No external CSS — styles inlined to keep the
// surface small and tightly scoped.

import {
  deleteSlot,
  downloadAsFile,
  listSlots,
  type SaveSlotMeta,
} from '../io/save';

const STYLE_ID = 'savedialog-style';

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .sd-overlay { position: fixed; inset: 0; background: rgba(5,8,12,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .sd-modal { background: #141c26; border: 1px solid #2a3a52; border-radius: 8px; padding: 16px 18px; min-width: 420px; max-width: 580px; max-height: 80vh; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 12px 36px rgba(0,0,0,0.4); }
    .sd-modal h3 { margin: 0; font-size: 14px; letter-spacing: 0.4px; color: #cfe2ff; }
    .sd-row { display: flex; gap: 8px; align-items: center; }
    .sd-input { flex: 1; background: #0e151d; color: #e6edf3; border: 1px solid #2a3a52; border-radius: 5px; padding: 6px 8px; font: inherit; }
    .sd-list { background: #0e151d; border: 1px solid #243142; border-radius: 6px; overflow-y: auto; max-height: 320px; padding: 4px; }
    .sd-item { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 4px; }
    .sd-item:hover { background: #16212f; }
    .sd-name { font-size: 13px; color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sd-meta { font-size: 11px; color: #8a98a8; }
    .sd-empty { color: #8a98a8; padding: 10px; font-size: 12px; }
    .sd-btn { background: #1c2a3d; color: #e6edf3; border: 1px solid #2a3a52; border-radius: 5px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; }
    .sd-btn:hover { border-color: #4ea1ff; }
    .sd-btn.primary { background: #1d3858; border-color: #4ea1ff; }
    .sd-btn.danger { color: #ff8585; border-color: #6a2929; }
    .sd-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .sd-spacer { flex: 1; }
    .sd-error { color: #ff8585; font-size: 12px; }
  `;
  document.head.appendChild(s);
};

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
};

const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface SaveDialogHandlers {
  onSave: (name: string) => Promise<void>;
  onLoad: (id: number) => Promise<void>;
  onExport: () => Promise<{ bytes: Uint8Array; suggestedName: string }>;
  onImport: () => Promise<void>;
  defaultName: string;
}

export const openSaveDialog = (h: SaveDialogHandlers): void => {
  ensureStyle();

  const overlay = document.createElement('div');
  overlay.className = 'sd-overlay';

  const modal = document.createElement('div');
  modal.className = 'sd-modal';
  overlay.appendChild(modal);

  const title = document.createElement('h3');
  title.textContent = '저장 / 불러오기';
  modal.appendChild(title);

  // Save row
  const saveRow = document.createElement('div');
  saveRow.className = 'sd-row';
  const nameInput = document.createElement('input');
  nameInput.className = 'sd-input';
  nameInput.placeholder = '슬롯 이름';
  nameInput.value = h.defaultName;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'sd-btn primary';
  saveBtn.textContent = '저장';
  saveRow.appendChild(nameInput);
  saveRow.appendChild(saveBtn);
  modal.appendChild(saveRow);

  // List
  const list = document.createElement('div');
  list.className = 'sd-list';
  modal.appendChild(list);

  const errorEl = document.createElement('div');
  errorEl.className = 'sd-error';
  modal.appendChild(errorEl);

  const setError = (msg: string): void => { errorEl.textContent = msg; };

  // Bottom actions
  const actions = document.createElement('div');
  actions.className = 'sd-actions';
  const importBtn = document.createElement('button');
  importBtn.className = 'sd-btn';
  importBtn.textContent = '파일에서 불러오기';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'sd-btn';
  exportBtn.textContent = '파일로 내보내기';
  const spacer = document.createElement('div');
  spacer.className = 'sd-spacer';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'sd-btn';
  closeBtn.textContent = '닫기';
  actions.appendChild(importBtn);
  actions.appendChild(exportBtn);
  actions.appendChild(spacer);
  actions.appendChild(closeBtn);
  modal.appendChild(actions);

  const close = (): void => { overlay.remove(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const renderList = async (): Promise<void> => {
    list.innerHTML = '';
    setError('');
    let slots: SaveSlotMeta[] = [];
    try {
      slots = await listSlots();
    } catch (e) {
      setError(`목록 조회 실패: ${String(e)}`);
      return;
    }
    if (slots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sd-empty';
      empty.textContent = '저장된 슬롯이 없습니다.';
      list.appendChild(empty);
      return;
    }
    for (const slot of slots) {
      const row = document.createElement('div');
      row.className = 'sd-item';
      const left = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'sd-name';
      name.textContent = slot.name || '<unnamed>';
      const meta = document.createElement('div');
      meta.className = 'sd-meta';
      meta.textContent = `${fmtDate(slot.ts)} · ${fmtSize(slot.byteLength)}`;
      left.appendChild(name);
      left.appendChild(meta);

      const loadB = document.createElement('button');
      loadB.className = 'sd-btn';
      loadB.textContent = '불러오기';
      loadB.addEventListener('click', async () => {
        try {
          await h.onLoad(slot.id);
          close();
        } catch (e) {
          setError(`불러오기 실패: ${String(e)}`);
        }
      });

      const delB = document.createElement('button');
      delB.className = 'sd-btn danger';
      delB.textContent = '삭제';
      delB.addEventListener('click', async () => {
        if (!confirm(`"${slot.name}"을(를) 삭제할까요?`)) return;
        try {
          await deleteSlot(slot.id);
          await renderList();
        } catch (e) {
          setError(`삭제 실패: ${String(e)}`);
        }
      });

      row.appendChild(left);
      row.appendChild(loadB);
      row.appendChild(delB);
      list.appendChild(row);
    }
  };

  saveBtn.addEventListener('click', async () => {
    setError('');
    const name = nameInput.value.trim() || h.defaultName;
    try {
      await h.onSave(name);
      await renderList();
    } catch (e) {
      setError(`저장 실패: ${String(e)}`);
    }
  });

  exportBtn.addEventListener('click', async () => {
    setError('');
    try {
      const { bytes, suggestedName } = await h.onExport();
      downloadAsFile(bytes, suggestedName);
    } catch (e) {
      setError(`내보내기 실패: ${String(e)}`);
    }
  });

  importBtn.addEventListener('click', async () => {
    setError('');
    try {
      await h.onImport();
      close();
    } catch (e) {
      setError(`불러오기 실패: ${String(e)}`);
    }
  });

  document.body.appendChild(overlay);
  void renderList();
};
