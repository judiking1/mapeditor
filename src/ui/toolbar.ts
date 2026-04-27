// Build the left-side tool palette. Each tool registers a click handler.
// Empty tools are stubs for upcoming milestones — they appear disabled.

export interface ToolDef {
  id: string;
  label: string;
  group: string;
  enabled: boolean;
}

export const DEFAULT_TOOLS: ToolDef[] = [
  { id: 'select',   label: '선택',         group: '기본',   enabled: true  },
  { id: 'pan',      label: '이동(공간)',    group: '기본',   enabled: true  },
  { id: 'road-straight', label: '도로(직선)', group: '도로', enabled: true  },
  { id: 'road-curved',   label: '도로(곡선)', group: '도로', enabled: true  },
  { id: 'road-erase',    label: '도로(철거)', group: '도로', enabled: true  },
  { id: 'spawn-50',   label: '차량 +50',    group: '차량',   enabled: true  },
  { id: 'spawn-500',  label: '차량 +500',   group: '차량',   enabled: true  },
  { id: 'spawn-clear',label: '차량 비우기', group: '차량',   enabled: true  },
  { id: 'time-pause', label: '⏸ 일시정지',  group: '시간',   enabled: true  },
  { id: 'time-1x',    label: '1x',          group: '시간',   enabled: true  },
  { id: 'time-3x',    label: '3x',          group: '시간',   enabled: true  },
  { id: 'time-9x',    label: '9x',          group: '시간',   enabled: true  },
  { id: 'zone-res',  label: '주거 존',     group: '존지정', enabled: true  },
  { id: 'zone-com',  label: '상업 존',     group: '존지정', enabled: true  },
  { id: 'zone-ind',  label: '산업 존',     group: '존지정', enabled: true  },
  { id: 'save',      label: '저장',        group: '파일',   enabled: true  },
  { id: 'load',      label: '불러오기',    group: '파일',   enabled: true  },
];

export interface Toolbar {
  active: string;
  setActive: (id: string) => void;
  on: (cb: (id: string) => void) => () => void;
}

export const buildToolbar = (root: HTMLElement, tools: ToolDef[] = DEFAULT_TOOLS): Toolbar => {
  const subs = new Set<(id: string) => void>();
  const groups = new Map<string, ToolDef[]>();
  for (const t of tools) {
    const arr = groups.get(t.group) ?? [];
    arr.push(t);
    groups.set(t.group, arr);
  }

  const buttons = new Map<string, HTMLButtonElement>();
  let active = 'select';

  for (const [name, items] of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'tool-group';
    const h = document.createElement('h4');
    h.textContent = name;
    wrap.appendChild(h);
    for (const t of items) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.textContent = t.label;
      b.dataset.id = t.id;
      b.disabled = !t.enabled;
      if (!t.enabled) b.title = '이후 마일스톤에서 활성화됩니다';
      b.dataset.active = String(t.id === active);
      b.addEventListener('click', () => {
        if (!t.enabled) return;
        setActive(t.id);
      });
      wrap.appendChild(b);
      buttons.set(t.id, b);
    }
    root.appendChild(wrap);
  }

  const setActive = (id: string): void => {
    active = id;
    for (const [tid, btn] of buttons) btn.dataset.active = String(tid === id);
    for (const cb of subs) cb(id);
  };

  return {
    get active() { return active; },
    setActive,
    on: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
};
