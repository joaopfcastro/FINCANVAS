import React, { useState, useRef, ReactNode, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;     // For outer container
  innerClassName?: string; // For scrollable container
}

export function PullToRefresh({ onRefresh, children, className = '', innerClassName = '' }: PullToRefreshProps) {
  const [startY, setStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pullDistance = Math.max(0, currentY - startY);
  const maxPullDistance = 80;
  const isPulling = pullDistance > 0 && !refreshing;

  useEffect(() => {
    const handleTouchMoveNative = (e: TouchEvent) => {
      if (startY > 0 && !refreshing && scrollRef.current && scrollRef.current.scrollTop <= 0) {
        const y = e.touches[0].clientY;
        if (y > startY) {
          if (e.cancelable) {
            e.preventDefault();
          }
        }
      }
    };

    const ref = scrollRef.current;
    if (ref) {
      ref.addEventListener('touchmove', handleTouchMoveNative, { passive: false });
    }
    return () => {
      if (ref) {
        ref.removeEventListener('touchmove', handleTouchMoveNative);
      }
    };
  }, [startY, refreshing]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only engage if at the very top of the scroll container
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      setStartY(e.touches[0].clientY);
      setCurrentY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY > 0 && !refreshing) {
      const y = e.touches[0].clientY;
      if (y > startY) {
        // Add resistance
        setCurrentY(startY + (y - startY) * 0.5);
      } else {
        // If they scroll up, reset
        setStartY(0);
        setCurrentY(0);
      }
    }
  };

  const handleTouchEnd = async () => {
    if (startY > 0 && pullDistance > maxPullDistance * 0.8 && !refreshing) {
      setRefreshing(true);
      await onRefresh();
      setRefreshing(false);
    }
    setStartY(0);
    setCurrentY(0);
  };

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Pull indicator */}
      <div 
        className="absolute w-full flex justify-center z-50 pointer-events-none"
        style={{ 
           top: 0,
           transform: refreshing ? `translateY(20px)` : (isPulling ? `translateY(${Math.min(pullDistance - 40, maxPullDistance/2)}px)` : 'translateY(-40px)'),
           opacity: refreshing || isPulling ? 1 : 0,
           transition: !isPulling ? 'transform 0.3s ease, opacity 0.3s ease' : 'none'
        }}
      >
        <div className="bg-white rounded-full p-2 shadow-lg flex items-center justify-center">
          <Loader2 
             className={`w-6 h-6 text-emerald-600 ${refreshing ? 'animate-spin' : ''}`} 
             style={{ transform: !refreshing ? `rotate(${pullDistance * 2}deg)` : undefined }} 
          />
        </div>
      </div>

      {/* Scrollable content wrapping */}
      <div 
        ref={scrollRef}
        className={`overflow-y-auto ${innerClassName}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: refreshing ? `translateY(10px)` : 'translateY(0)',
          transition: !isPulling ? 'transform 0.3s ease' : 'none',
          // Prevent scroll-chaining native pull-to-refresh
          overscrollBehaviorY: 'contain'
        }}
      >
        {children}
      </div>
    </div>
  );
}
