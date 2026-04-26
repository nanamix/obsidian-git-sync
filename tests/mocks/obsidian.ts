// Minimal stubs of the Obsidian Plugin API needed for unit tests.
// Real Obsidian provides these at runtime.

export class Notice {
  constructor(public message: string, public timeoutMs?: number) {}
  setMessage(_msg: string): this { return this; }
  hide(): void {}
}

export class PluginSettingTab {
  containerEl: HTMLElement = { empty: () => {}, createEl: () => ({} as any) } as any;
  constructor(public app: App, public plugin: Plugin) {}
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(_n: string): this { return this; }
  setDesc(_d: string): this { return this; }
  addText(_cb: (t: any) => void): this { return this; }
  addToggle(_cb: (t: any) => void): this { return this; }
  addDropdown(_cb: (d: any) => void): this { return this; }
  addButton(_cb: (b: any) => void): this { return this; }
}

export class App {
  workspace = new Workspace();
  vault = new Vault();
}

export class Workspace {
  on(_event: string, _cb: (...args: any[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }
  trigger(_event: string, ..._args: any[]): void {}
}

export class Vault {
  adapter = { basePath: '/tmp/fake-vault' };
  on(_event: string, _cb: (...args: any[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }
}

export class Plugin {
  app: App = new App();
  manifest: any = {};
  settings: any = {};
  addRibbonIcon(_icon: string, _title: string, _cb: (e: MouseEvent) => void): HTMLElement {
    return {} as HTMLElement;
  }
  addStatusBarItem(): HTMLElement {
    const el: any = {
      setText: (_t: string) => {},
      addClass: (_c: string) => {},
      removeClass: (_c: string) => {},
      onClickEvent: (_cb: () => void) => {},
    };
    return el as HTMLElement;
  }
  addCommand(_cmd: { id: string; name: string; callback: () => void }): void {}
  addSettingTab(_tab: PluginSettingTab): void {}
  registerInterval(_id: number): number { return 0; }
  registerEvent(_evt: { unload: () => void }): void {}
  async loadData(): Promise<any> { return {}; }
  async saveData(_d: any): Promise<void> {}
  onload(): void | Promise<void> {}
  onunload(): void {}
}

export type EventRef = { unload: () => void };
