"use client";
// beui.dev/components/motion/shared-layout-bg
// Ported from the beUI shadcn registry; Tailwind utilities replaced with the app's CSS classes.

import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  Children,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  type FocusEvent,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useId,
  useRef,
  useState,
} from "react";
import { SPRING_LAYOUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

export interface SharedLayoutBgProps
  extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  /** Extra class applied to the moving pill. */
  pillClassName?: string;
  /** Horizontal inset of the pill relative to each row (px). Default 0. */
  inset?: number;
  /** Optional positioning override for the pill wrapper inside each item. */
  pillContainerClassName?: string;
}

const variants: Variants = {
  initial: { opacity: 0, filter: "blur(6px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: (isActive: boolean) =>
    !isActive ? { opacity: 0, filter: "blur(6px)" } : {},
};

const reducedVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
};

export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
  function SharedLayoutBg(
    {
      children,
      className,
      onMouseLeave,
      onBlur,
      pillClassName,
      pillContainerClassName,
      inset = 0,
      ...props
    },
    forwardedRef,
  ) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const uid = useId();
    const reduce = useReducedMotion();
    // Focus leaving the list only clears the pill when the pointer is not
    // still resting on an item.
    const hovering = useRef(false);

    const renderedChildren = Children.toArray(children)
      .filter(isValidElement)
      .map((child, index) => {
        const el = child as ReactElement<{
          className?: string;
          onMouseEnter?: () => void;
          onFocus?: (event: FocusEvent<HTMLElement>) => void;
          children?: ReactNode;
        }>;
        const childKey = el.key ? String(el.key) : `item-${index}`;
        return cloneElement(
          el,
          {
            key: childKey,
            className: cn("beui-item", el.props.className),
            onMouseEnter: () => {
              el.props.onMouseEnter?.();
              hovering.current = true;
              setActiveId(childKey);
            },
            // Focus bubbles in React, so a button anywhere inside the item
            // brings the pill to it for keyboard users too.
            onFocus: (event: FocusEvent<HTMLElement>) => {
              el.props.onFocus?.(event);
              setActiveId(childKey);
            },
          },
          <>
            <AnimatePresence custom={activeId !== null}>
              {activeId !== null ? (
                <motion.div
                  variants={reduce ? reducedVariants : variants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  custom={activeId !== null}
                  className={cn("beui-pill-anchor", pillContainerClassName)}
                  style={{ left: -inset, right: -inset }}
                >
                  {activeId === childKey ? (
                    <motion.div
                      layoutId={`shared-bg-${uid}`}
                      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                      className={cn("beui-pill", pillClassName)}
                    />
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <div className="beui-item-inner">{el.props.children}</div>
          </>,
        );
      });

    const handleMouseLeave = (event: MouseEvent<HTMLElement>) => {
      hovering.current = false;
      // Keep the pill on a focused item so keyboard position stays visible.
      if (!event.currentTarget.contains(document.activeElement))
        setActiveId(null);
      onMouseLeave?.(event);
    };

    const handleBlur = (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (
        !hovering.current &&
        !(next instanceof Node && event.currentTarget.contains(next))
      )
        setActiveId(null);
      onBlur?.(event);
    };

    // layoutRoot scopes the pill's layout projection to this list, so fixed or
    // scrolled ancestors can't smear scroll offsets into its movement.
    return (
      <motion.div
        {...(props as HTMLMotionProps<"div">)}
        ref={forwardedRef as Ref<HTMLDivElement>}
        layoutRoot
        onMouseLeave={handleMouseLeave}
        onBlur={handleBlur}
        className={cn("beui-shared-bg", className)}
      >
        {renderedChildren}
      </motion.div>
    );
  },
);
