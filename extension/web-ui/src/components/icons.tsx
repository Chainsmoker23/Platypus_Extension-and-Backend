
import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

export const VscFile: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M4 14.5V1.5H9.5L12 4V14.5H4ZM5 2.5V13.5H11V4.5H8.5V2.5H5Z" /></svg>
);

export const VscFolder: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M1.5 2.5L1 3V13L1.5 13.5H14.5L15 13V4L14.5 3.5H8L6.5 2H1.5L1.5 2.5ZM2 3.5V12.5H14V4.5H2Z" /></svg>
);

export const VscChevronRight: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M6.5 12.5L10.5 8.5L6.5 4.5V12.5Z" /></svg>
);

export const VscChevronDown: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M12.5 6.5L8.5 10.5L4.5 6.5H12.5Z" /></svg>
);

export const PlatypusIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 80 40" fill="currentColor" {...props}>
        <path d="M21,25.3L6.5,28.6L5.9,32.4L0,31.2V28.3L19.4,24.4L22.1,18L10.3,20.4L11.2,14L22.1,11.7L25.8,0.5L30.5,0L26.5,11.7L31.8,10.6L32.7,15.1L23,17.2L21,25.3z M40.7,33.5L34.9,32L32.1,25.9L40.2,24.2L42.1,30.7L40.7,33.5z M43.9,22.7L54.3,20.4L55.8,25.9L48.2,27.4L43.9,22.7z M57.3,26.8L61.6,21.2L69.3,22.7L74,17.2L79.4,18.4L78.2,24.1L70.9,26.5L65.9,35.2L60.5,34.3L57.3,26.8z M21.9,26.2L22.8,18.2L31.8,16.4L33.9,24.2L32.6,30.5L25.9,31.7L21.9,26.2z"/>
    </svg>
);

export const VscSend: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M1.17 7.12l12.23-5.24c.48-.2.9.27.7.74L8.85 14.86c-.2.47-.82.47-1.02 0L6.08 9.92 1.13 8.16c-.48-.16-.48-.79 0-.94zm.83.6l3.5 1.17 4.15 4.15 4.1-9.58-9.58 4.1.83.26z"/></svg>
);

export const VscCheck: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M14.47 5.53l-8.5 8.5-4.5-4.5 1.06-1.06 3.44 3.44 7.44-7.44 1.06 1.06z"/></svg>
);

export const VscClose: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M8 6.586l-4.293-4.293-1.414 1.414L6.586 8l-4.293 4.293 1.414 1.414L8 9.414l4.293 4.293 1.414-1.414L9.414 8l4.293-4.293-1.414-1.414L8 6.586z"/></svg>
);

export const VscFileCode: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M11 5.5l-1.5 1.5 1.5 1.5.75-.75L10.5 7l1.25-1.25-.75-.75zm-6 0l-.75.75L5.5 7 4.25 8.25l.75.75 1.5-1.5-1.5-1.5zM8.5 4h-1v8h1V4zM4 14.5V1.5H9.5L12 4v10.5H4zm1-1h6V4.5H8.5V2.5H5v11z"/></svg>
);

export const VscLoading: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path fillRule="evenodd" clipRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z" opacity=".2"/><path d="M7.25.762a.75.75 0 0 1 1.5 0V3.5a.75.75 0 0 1-1.5 0V.762z"/></svg>
);

export const VscAccount: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M8 0a4 4 0 0 0-4 4v2a4 4 0 0 0 4 4 4 4 0 0 0 4-4V4a4 4 0 0 0-4-4zM6 4a2 2 0 1 1 4 0v2a2 2 0 1 1-4 0V4z"/><path d="M2.5 12a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z"/></svg>
);

export const VscSparkle: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M8 .5l1.54 3.46L13 5.5l-2.46 2.46L12.5 12 8 10.23 3.5 12l1.96-3.96L3 5.5l3.46-1.54z"/></svg>
);

export const VscUndo: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M.5 7.5H10c2.21 0 4 1.79 4 4v.5h-1.5v-.5c0-1.38-1.12-2.5-2.5-2.5H.5l3.15 3.15L2.59 12.5.09 10 2.59 7.5l1.06 1.06L.5 7.5z"/></svg>
);

export const VscEllipsis: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>
);

export const VscNewFile: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M3 1.5h6.5L12 4v3.5H3V1.5zM4 2.5v5h7V4.5H8.5V2.5H4zm4.5 7H12v-1h-1v-1h-1v1h-1v1h.5v.5H8v1h.5v.5h-1v1h1v-1h.5v-.5H12v-1h-1v-1h-1.5v-.5zM3 8.5h3.5v5H3v-5zm1 1v3h1.5v-3H4z"/></svg>
);

export const VscTrash: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M4.5 2.5l.5-1h5l.5 1H14v1H2v-1h2.5zm-.5 2v9h10v-9h-10zm2 1h1v6h-1v-6zm3 0h1v6h-1v-6z"/></svg>
);

export const VscMove: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}><path d="M12.5 6.5L15 8l-2.5 1.5v-3zM9.5 9.5l1.5 2.5H8l-1.5-2.5h3zM6.5 6.5v3L5 8l1.5-1.5zM9.5 3.5L8 5l-1.5-1.5h3zM8 0L5.5 2.5H2v12h12v-12H10.5L8 0zM3 13.5V3.5h2.09L7 5.41 8 6.32l1- .91 1.91-1.91H13v10H3z"/></svg>
);
