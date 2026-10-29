'use client';

// Placeholders shaped like the final layout, so a screen never shows a bare
// "loading" line or half-filled data while its first page arrives.

const block = 'bg-[#1F1F1F] rounded animate-pulse';

/** Poster grid: same columns as CatalogScreen. */
export function PosterGridSkeleton({ count = 18 }: { count?: number }) {
    const cells = [];
    for (let i = 0; i < count; i++) {
        cells.push(
            <div key={i} className="w-1/3 sm:w-1/4 lg:w-1/5 xl:w-1/6 2xl:w-[14.285%] px-2.5 pb-7 phone:w-[14.285%] phone:px-1.5 phone:pb-4">
                <div className="ratio ratio-poster">
                    <div className={`ratio-fill ${block} rounded-md`} />
                </div>
                <div className={`mt-2.5 h-3.5 w-3/4 ${block}`} />
                <div className={`mt-1.5 h-3 w-1/2 ${block}`} />
            </div>,
        );
    }
    return <div className="flex flex-wrap -mx-2.5 phone:-mx-1.5" aria-hidden="true">{cells}</div>;
}

/** Channel rows: same height and columns as the live list. */
export function ChannelListSkeleton({ count = 10 }: { count?: number }) {
    const rows = [];
    for (let i = 0; i < count; i++) {
        rows.push(
            <div key={i} className="flex items-center py-3 pr-3 pl-5 border-b border-[#1C1C1C]">
                <div className={`w-6 h-3 ${block}`} />
                <div className={`w-[52px] h-[52px] ml-[22px] flex-shrink-0 ${block} rounded-md`} />
                <div className="flex-1 min-w-0 ml-[14px]">
                    <div className={`h-3.5 w-2/3 ${block}`} />
                    <div className={`mt-2 h-3 w-1/2 ${block}`} />
                    <div className={`mt-2 h-[3px] w-full ${block}`} />
                </div>
            </div>,
        );
    }
    return <div aria-hidden="true">{rows}</div>;
}

/** Category sidebar rows. */
export function SidebarSkeleton() {
    const rows = [];
    for (let i = 0; i < 10; i++) {
        rows.push(<div key={i} className={`h-11 mb-0.5 ${block}`} style={{ opacity: 1 - i * 0.07 }} />);
    }
    return (
        <aside className="hidden md:block phone:hidden md:flex-[20_1_0%] md:min-w-[240px] h-full bg-black border-r border-[#222222] px-3 py-5" aria-hidden="true">
            <div className={`h-11 ${block} rounded-md`} />
            <div className="mt-4">{rows}</div>
        </aside>
    );
}
