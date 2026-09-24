import { Spin } from 'antd';

export function PageLoader() {
  return (
    <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
      <Spin />
    </div>
  );
}
