/**
 * Icons, drawn inline.
 *
 * The dependency list in CLAUDE.md is fixed and does not include an icon
 * library, so these are hand-written SVG paths on a 24-unit grid with a 1.7
 * stroke. They inherit `currentColor` and their size from the `size` prop, so
 * an icon always matches the text it sits beside.
 *
 * Every icon in this app sits next to a word. None of them carries meaning on
 * its own — see the note at the top of index.css.
 */

function Svg({ size = 16, children, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Search = (p) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
);

export const X = (p) => (
  <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
);

export const ChevronRight = (p) => (
  <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>
);

export const ArrowLeft = (p) => (
  <Svg {...p}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Svg>
);

export const ArrowUp = (p) => (
  <Svg {...p}><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></Svg>
);

export const ArrowDown = (p) => (
  <Svg {...p}><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></Svg>
);

/** Overrun. Used wherever a number is past its plan or its target. */
export const Alert = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </Svg>
);

export const Clock = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);


export const Users = (p) => (
  <Svg {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.2" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.87" /><path d="M16.5 4.1a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const Check = (p) => (
  <Svg strokeWidth="2.4" {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
);

export const LogOut = (p) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
  </Svg>
);

/** Stage groups: layers of work stacked in order. */
export const Layers = (p) => (
  <Svg {...p}>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
  </Svg>
);

export const Activity = (p) => (
  <Svg {...p}><path d="M22 12h-4l-3 8-6-16-3 8H2" /></Svg>
);

/** A project with nothing recorded. Shown, never hidden. */
export const Dashed = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" strokeDasharray="3 3.2" /></Svg>
);

export const Folder = (p) => (
  <Svg {...p}>
    <path d="M3 8a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
  </Svg>
);

export const Inbox = (p) => (
  <Svg {...p}>
    <path d="M21 12h-6l-1.5 3h-3L9 12H3" />
    <path d="M5.5 5.5h13l2.5 6.5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6l2.5-6.5Z" />
  </Svg>
);

/* --- added for the analytics screen and the project form --- */

/** The table twin behind every figure. */
export const Table = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M9 9.5V20" />
  </Svg>
);

export const ChartIcon = (p) => (
  <Svg {...p}>
    <path d="M4 20V5" /><path d="M4 20h16" />
    <rect x="7.5" y="12" width="3.2" height="5" rx="1" />
    <rect x="13.5" y="8" width="3.2" height="9" rx="1" />
  </Svg>
);

export const Plus = (p) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const Pencil = (p) => (
  <Svg {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 6.5 3 3" />
  </Svg>
);

/** A deadline. Sits beside the word "deadline", never instead of it. */
export const Calendar = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

export const TrendIcon = (p) => (
  <Svg {...p}><path d="M3 16.5 9 10l4 4 7.5-8" /><path d="M15 6h6v6" /></Svg>
);

export const Rocket = (p) => (
  <Svg {...p}>
    <path d="M13.5 3.5c3.8.4 6.6 3.2 7 7l-6 6-7-7 6-6Z" />
    <circle cx="14.5" cy="9.5" r="1.6" />
    <path d="M7.5 16.5 4 20M9.5 13.5 4.5 15M10.5 18.5 9 21" />
  </Svg>
);

/** Adding a colleague to the roster: the Users figure with a plus beside it. */
export const UserPlus = (p) => (
  <Svg {...p}>
    <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="8.5" cy="7" r="3.2" />
    <path d="M19 8v6M22 11h-6" />
  </Svg>
);

/** Archiving one: a box with a lid, because they are put away rather than lost. */
export const Archive = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </Svg>
);

/** Restoring one: the same box, with an arrow coming back out of it. */
export const Undo = (p) => (
  <Svg {...p}>
    <path d="M3 9h11a5 5 0 0 1 0 10H8" /><path d="m7 5-4 4 4 4" />
  </Svg>
);
