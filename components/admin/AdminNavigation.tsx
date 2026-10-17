'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { PRIMARY_NAV, type NavDropdownItem } from './navData';

export default function AdminNavigation() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null);

  const isActive = (match: string[]) => pathname === match[0] || (match.length > 1 && match.includes(pathname));
  const groupMatches = (items: { href: string }[]) => items.some((i) => i.href === pathname);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!openMenu || !navRef.current) { setDropdownPos(null); return; }
    const btn = btnRefs.current[openMenu];
    if (!btn) { setDropdownPos(null); return; }
    const navRect = navRef.current.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setDropdownPos({ left: btnRect.left - navRect.left, top: navRect.height });
  }, [openMenu]);

  const openItem = openMenu ? PRIMARY_NAV.find((i) => 'items' in i && i.label === openMenu) as NavDropdownItem | undefined : undefined;

  return (
    <nav
      ref={navRef}
      className="relative z-30 w-full border-b border-[#2a3b5c] bg-[#081226]"
      style={{ height: 56 }}
    >
      <div className="h-full overflow-x-auto">
        <ul className="flex h-full min-w-max items-stretch justify-center whitespace-nowrap">
          {PRIMARY_NAV.map((item) => {
            if ('items' in item) {
              const open = openMenu === item.label;
              const active = groupMatches(item.items);
              return (
                <li key={item.label} className="flex">
                  <button
                    ref={(el) => { btnRefs.current[item.label] = el; }}
                    onClick={() => setOpenMenu(open ? null : item.label)}
                    className={`flex h-full items-center gap-1.5 px-4 text-sm font-medium transition ${
                      active ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300 hover:bg-[#0e1a33] hover:text-white'
                    }`}
                  >
                    {item.label}
                    <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
                  </button>
                </li>
              );
            }
            const active = isActive(item.match);
            return (
              <li key={item.label} className="flex">
                <Link
                  href={item.href}
                  className={`flex h-full items-center px-4 text-sm font-medium transition ${
                    active ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300 hover:bg-[#0e1a33] hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {openItem && dropdownPos && (
        <ul
          className="absolute z-50 w-56 rounded-b-lg border border-t-0 border-[#2a3b5c] bg-[#081226] py-1 shadow-xl shadow-black/50"
          style={{ left: dropdownPos.left, top: dropdownPos.top }}
        >
          {openItem.items.map((leaf) => (
            <li key={leaf.href}>
              <Link
                href={leaf.href}
                onClick={() => setOpenMenu(null)}
                className={`block whitespace-nowrap px-4 py-2.5 text-sm transition ${
                  pathname === leaf.href ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300 hover:bg-[#0e1a33] hover:text-white'
                }`}
              >
                {leaf.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
