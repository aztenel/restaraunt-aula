/**
 * Совместимость Ant Design 5 с React 19: статические методы и всплывающие элементы
 * рендерятся через createRoot (аналог пакета @ant-design/v5-patch-for-react-19).
 */
import { unstableSetRender } from 'antd';
import { createRoot, type Root } from 'react-dom/client';

type ContainerWithRoot = Element | DocumentFragment;
const roots = new WeakMap<ContainerWithRoot, Root>();

unstableSetRender((node, container) => {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(node);
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.unmount();
    roots.delete(container);
  };
});
