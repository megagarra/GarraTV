'use client';

import React from 'react';

export interface FieldProps {
    label: string;
    htmlFor?: string;
    error?: string;
    hint?: string;
    children: React.ReactNode;
}

/** Shared class string for inputs, so it isn't repeated across 12 forms. */
export const inputClassName =
    'w-full h-11 px-[14px] rounded-md bg-surface border border-line-strong text-ink placeholder:text-ink-3 text-sm md:text-base transition-colors duration-200 focus:border-brand';

export default function Field({ label, htmlFor, error, hint, children }: FieldProps) {
    return (
        <div>
            <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-2 mb-2">
                {label}
            </label>
            {children}
            {error ? (
                <p className="text-xs text-brand mt-1.5">{error}</p>
            ) : hint ? (
                <p className="text-xs text-ink-3 mt-1.5">{hint}</p>
            ) : null}
        </div>
    );
}
