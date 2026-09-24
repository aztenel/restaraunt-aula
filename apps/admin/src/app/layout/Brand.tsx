/** Логотип AULA в меню (орнамент «қошқар мүйіз» + словознак). */
export function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '0 20px' : '0 20px', color: '#e8c878' }}>
      <svg viewBox="0 0 64 36" width="32" height="20" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M32 34V17c0-6.5-5.5-11.5-12-10.5C13.8 7.4 12.4 16 18.5 17.3c4.2.9 5.8-4.6 2.3-5.8" />
          <path d="M32 17c0-6.5 5.5-11.5 12-10.5 6.2.9 7.6 9.5 1.5 10.8-4.2.9-5.8-4.6-2.3-5.8" />
        </g>
      </svg>
      {collapsed ? null : (
        <span style={{ color: '#fffcf7', fontWeight: 700, letterSpacing: '0.18em', fontSize: 18 }}>AULA</span>
      )}
    </div>
  );
}
