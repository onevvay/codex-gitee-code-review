import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

const iframe = document.querySelector('iframe');
const bridge = new AppBridge(null, { name: 'Synthetic preview host', version: '0.1.0' }, { serverTools: {}, openLinks: {}, message: {} }, { hostContext: { theme: 'light', displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } });
async function post(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return response.json();
}
bridge.oncalltool = input => post('/call', input);
bridge.onmessage = input => post('/message', input);
bridge.onopenlink = async () => ({ isError: false });
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult({ content: [], structuredContent: { view: 'inbox', target: null } });
};
await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
iframe.src = '/ui.html';
window.previewHost = bridge;
