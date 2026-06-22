import { useEffect, useState } from 'react';

/**
 * Returns the height of the virtual keyboard in CSS pixels, estimated from
 * the difference between `window.innerHeight` and the Visual Viewport height.
 *
 * On desktop (and when no keyboard is shown) this is always 0.
 * On iOS/Android when the software keyboard is open, this becomes the keyboard height,
 * so dialogs and other fixed-position overlays can shift upward to stay visible.
 *
 * Falls back gracefully when `window.visualViewport` is unavailable.
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // window.innerHeight stays constant on iOS when keyboard opens.
      // visualViewport.height shrinks by the keyboard height.
      const kh = Math.max(0, window.innerHeight - vv.height);
      setKeyboardHeight(kh);
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return keyboardHeight;
}
