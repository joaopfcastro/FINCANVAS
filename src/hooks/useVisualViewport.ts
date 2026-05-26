import { useState, useEffect } from 'react';

export function useVisualViewport() {
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  
  const [offsetTop, setOffsetTop] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (!window.visualViewport) {
      const handleResize = () => {
        setViewportHeight(window.innerHeight);
        setOffsetTop(0);
      };
      window.addEventListener('resize', handleResize);
      handleResize();
      return () => window.removeEventListener('resize', handleResize);
    }

    const vv = window.visualViewport;
    
    const handleResize = () => {
      setViewportHeight(vv.height);
      setOffsetTop(vv.offsetTop);
      setIsKeyboardOpen(vv.height < window.innerHeight * 0.85);
    };

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);

    handleResize();

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, []);

  return { viewportHeight, offsetTop, isKeyboardOpen };
}
