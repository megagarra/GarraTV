'use client';

import React from 'react';
import { Loader2, LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: LucideIcon;
    loading?: boolean;
    fullWidth?: boolean;
}

// `focus:ring-*` is intentionally absent — the global `[data-focusable="true"]:focus`
// rule in globals.css owns every focus treatment in the app (spec 00 §4).
const VARIANT_CLASSNAME: Record<ButtonVariant, string> = {
    // GarraTV: solid red primary, translucent grey secondary.
    primary: 'bg-brand text-white hover:bg-brand-strong focus:bg-brand-strong',
    secondary: 'bg-[rgba(109,109,110,0.45)] text-ink hover:bg-[rgba(109,109,110,0.7)] focus:bg-[rgba(109,109,110,0.7)]',
    ghost: 'text-ink-2 hover:text-ink focus:text-ink',
    danger: 'bg-surface-2 text-brand border border-line-strong hover:bg-surface-3',
};

const SIZE_CLASSNAME: Record<ButtonSize, string> = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-sm md:text-base',
    lg: 'h-14 px-6 text-base md:text-lg',
};

const ICON_SIZE: Record<ButtonSize, number> = {
    sm: 16,
    md: 18,
    lg: 20,
};

export default function Button({
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    loading = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...rest
}: ButtonProps) {
    const isDisabled = disabled || loading;

    return (
        <button
            {...rest}
            disabled={isDisabled}
            data-focusable={isDisabled ? undefined : 'true'}
            tabIndex={isDisabled ? undefined : 0}
            className={[
                'inline-flex items-center justify-center rounded-md font-bold transition-colors duration-200',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                VARIANT_CLASSNAME[variant],
                SIZE_CLASSNAME[size],
                fullWidth ? 'w-full' : '',
                className,
            ].join(' ')}
        >
            {loading ? (
                <Loader2 size={ICON_SIZE[size]} className="animate-spin mr-2" />
            ) : Icon ? (
                <Icon size={ICON_SIZE[size]} className="mr-2" />
            ) : null}
            {children}
        </button>
    );
}
