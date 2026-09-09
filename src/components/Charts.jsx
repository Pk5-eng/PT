import { useId, useMemo, useRef, useState } from 'react';
import { Table as TableIcon, ChartIcon } from './Icons.jsx';

/**
 * Charts, drawn by hand.
 *
 * The dependency list in CLAUDE.md does not include a charting library and
 * adding one would be a large dependency for six figures, so these are plain
 * SVG. That constraint turns out to be the easy part; the rules below are the
 * work, and they are the reason the charts look like one system rather than six
 * accidents.
 *
 *   Marks are thin, with a 4px rounded data end anchored to a baseline at zero.
 *   Adjacent fills are separated by a 2px gap of surface, never by a border.
 *   Grid and axis lines are solid hairlines one shade off the surface; never
 *     dashed, because dashing reads as "projection" when it is just a grid.
 *   Colour never carries meaning alone. Every bar is direct-labelled with its
 *     value, every figure has a table twin behind the "Numbers" toggle, and a
 *     series with a colour also has a legend entry with a word in it.
 *   There is exactly one value axis per figure. Two measures on two scales in
 *     one plot invent a correlation that is not in the data.
 *
 * The palette is a validated categorical set: the ordering is what keeps
 * adjacent slots separable under colour-vision deficiency, so slots are
 * assigned in fixed order and never cycled. Three of the light-mode slots fall
 * below 3:1 against white, which is exactly why the direct labels and the table
 * twin above are not optional.
 */

/* ------------------------------------------------------------------ tooltip */

function useTooltip() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);

  const show = (e, content) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
  };
  const hide = () => setTip(null);

  const node = tip && (
    <div
      className="tip"
      role="status"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > (box.current?.clientWidth ?? 0) - 160 ? '-100%' : '8px'}, -50%)` }}
    >
      {tip.content}
    </div>
  );
  return { box, show, hide, node };
}

/* ------------------------------------------------------------------- figure */

/**
 * The card every chart lives in. Carries the title, the sentence that says what
 * the figure actually claims, and the table twin.
 *
 * The toggle is not a nicety. Colour and length are both approximations; the
 * table is the version that is exactly right, and it is one click away from
 * every figure on the screen rather than living on a separate page nobody opens.
 */
export function Figure({ title, claim, columns, rows, empty, children }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  const hasData = rows && rows.length > 0;

  return (
    <figure className="fig">
      <figcaption>
        <div>
          <h3>{title}</h3>
          {claim && <p>{claim}</p>}
        </div>
        {hasData && (
          <button
            type="button"
            className="chip sm"
            aria-pressed={asTable}
            aria-controls={id}
            onClick={() => setAsTable((v) => !v)}
            title={asTable ? 'Back to the chart' : 'Read the exact numbers'}
          >
            {asTable ? <ChartIcon size={13} /> : <TableIcon size={13} />}
            {asTable ? 'Chart' : 'Numbers'}
          </button>
        )}
      </figcaption>

      <div id={id} className="figbody">
        {!hasData ? (
          <p className="empty">{empty}</p>
        ) : asTable ? (
          <div className="figtable">
            <table>
              <thead>
                <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      j === 0
                        ? <th key={j} scope="row">{cell}</th>
                        : <td key={j} className="num">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : children}
      </div>
    </figure>
  );
}

/* --------------------------------------------------------------- bar series */

const ROW_H = 30;          // >= the 24px minimum hit target, with room to breathe
const BAR_H = 13;          // thin mark
const LABEL_W = 168;
const VALUE_W = 58;

/**
 * A ranked horizontal bar list.
 *
 * Horizontal because the categories are project and people names, which are
 * long and would either be rotated or truncated on a vertical axis. Ranked
 * because the question these figures answer is always "which ones", and a
 * ranked list answers it without the reader doing any comparing.
 *
 * `mark` draws a second, thin reference tick - the planned duration - on the
 * same axis as the bar. It is the same measure in the same unit, so it is not a
 * second axis; it is the only honest way to show "84 days against a plan of 18".
 */
export function Bars({ data, unit = '', color = 'var(--series-1)', highlight, max: fixedMax, mark,
                       labelWidth = LABEL_W }) {
  const t = useTooltip();
  const max = Math.max(fixedMax ?? 0, ...data.map((d) => Math.max(d.value, mark?.(d) ?? 0)), 1);

  return (
    <div className="barwrap" ref={t.box}>
      {/* The baseline is drawn by the list itself, as a hairline down the left
          edge of the track column, so it can never drift out of alignment with
          the bars the way a separately positioned axis would. */}
      <ul className="bars" style={{ '--label-w': `${labelWidth}px`, '--value-w': `${VALUE_W}px` }}>
        {data.map((d) => {
          const over = highlight?.(d);
          const planned = mark?.(d);
          return (
            <li
              key={d.id ?? d.label}
              style={{ height: ROW_H }}
              onMouseMove={(e) => t.show(e, (
                <>
                  <strong>{d.label}</strong>
                  <span>{d.value} {unit}{d.meta ? ` \u00b7 ${d.meta}` : ''}</span>
                  {planned != null && <span>plan {planned} {unit}</span>}
                </>
              ))}
              onMouseLeave={t.hide}
            >
              <span className="lab" title={d.label}>{d.label}</span>
              <span className="track">
                <span
                  className="bar"
                  style={{
                    width: `${Math.max((d.value / max) * 100, d.value > 0 ? 1.5 : 0)}%`,
                    height: BAR_H,
                    background: over ? 'var(--status-critical)' : color,
                  }}
                />
                {planned != null && planned > 0 && (
                  <span className="planmark" style={{ left: `${(planned / max) * 100}%` }}
                        title={`plan ${planned} ${unit}`} />
                )}
              </span>
              <span className={`val num${over ? ' over' : ''}`}>{d.value}</span>
            </li>
          );
        })}
      </ul>
      {t.node}
    </div>
  );
}

/** A legend row. Present whenever a figure's colour carries a distinction. */
export function Key({ items }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className="sw" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- area line */

/**
 * A single measure over time. One series, so no legend box: the title names it.
 * Direct-labelled at the endpoint and the peak only; the crosshair and tooltip
 * carry every other month, and the table twin carries all of them exactly.
 */
export function Trend({ data, unit = '' }) {
  const t = useTooltip();
  const [at, setAt] = useState(null);
  const W = 620, H = 150, PAD_L = 28, PAD_B = 26, PAD_T = 12, PAD_R = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const x = (i) => PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => PAD_T + plotH - (v / max) * plotH;

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z`;

  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const last = data.length - 1;
  const ticks = useMemo(() => {
    const step = max <= 4 ? 1 : Math.ceil(max / 4);
    const out = [];
    for (let v = 0; v <= max; v += step) out.push(v);
    return out;
  }, [max]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(data.length - 1,
      Math.round(((px - PAD_L) / plotW) * (data.length - 1))));
    setAt(i);
    t.show(e, <><strong>{data[i].label}</strong><span>{data[i].value} {unit}</span></>);
  };

  return (
    <div className="trendwrap" ref={t.box}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={`${unit} per month; peak ${data[peak].value} in ${data[peak].label}`}
           onMouseMove={onMove} onMouseLeave={() => { setAt(null); t.hide(); }}>
        <defs>
          <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD_L - 7} y={y(v) + 4} className="tick end">{v}</text>
          </g>
        ))}

        <path d={area} fill="url(#trendfill)" />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

        {at != null && (
          <line x1={x(at)} x2={x(at)} y1={PAD_T} y2={PAD_T + plotH} className="crosshair" />
        )}

        {data.map((d, i) => (
          (i === peak || i === last || i === at) && (
            <circle key={i} cx={x(i)} cy={y(d.value)} r="4.5"
                    fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
          )
        ))}

        {/* Selective direct labels: the peak and the latest month, never every point. */}
        {[peak, last].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(i)} y={y(data[i].value) - 10} className="pointlabel"
                textAnchor={i === last ? 'end' : 'middle'}>{data[i].value}</text>
        ))}

        {data.map((d, i) => (
          (i % 2 === 0 || i === last) && (
            <text key={d.key} x={x(i)} y={H - 7} className="tick"
                  textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>{d.label}</text>
          )
        ))}
      </svg>
      {t.node}
    </div>
  );
}

/* -------------------------------------------------------------- composition */

/**
 * Part of a whole, as one bar rather than a pie: the segments are compared
 * against each other and a pie makes close values indistinguishable. Capped at
 * six segments, which the project statuses cannot exceed.
 *
 * Segments are separated by a 2px gap of surface, not by a stroke, and every
 * one is named in the legend with its count. Colour is the fast channel; the
 * legend is the true one.
 */
export function Composition({ data, colors, total }) {
  const t = useTooltip();
  const sum = total ?? data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="compwrap" ref={t.box}>
      <div className="compbar">
        {data.map((d, i) => (
          <span
            key={d.label}
            className="seg"
            style={{ flexGrow: d.value, background: colors[i % colors.length] }}
            onMouseMove={(e) => t.show(e, <><strong>{d.label}</strong><span>{d.value} of {sum}</span></>)}
            onMouseLeave={t.hide}
          >
            {/* Only labelled in place when it fits; otherwise the legend carries it. */}
            {d.value / sum > 0.12 && <span className="segval num">{d.value}</span>}
          </span>
        ))}
      </div>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <span className="sw" style={{ background: colors[i % colors.length] }} />
            {d.label}
            <span className="num">{d.value}</span>
          </li>
        ))}
      </ul>
      {t.node}
    </div>
  );
}

/* -------------------------------------------------------------- stat tiles */

/**
 * A number is not a chart. Four of the questions this screen answers have a
 * single number as their whole answer, and a one-bar bar chart would be a
 * decoration around it.
 */
export function Tile({ n, label, note, tone }) {
  return (
    <div className={`tile${tone ? ` t-${tone}` : ''}`}>
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
