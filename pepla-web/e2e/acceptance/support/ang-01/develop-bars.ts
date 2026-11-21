/**
 * ANG-01 AC-9 and AC-15: the top bars as develop 06201c3 shows them (unchanged on develop 49fd825), read from the page with `barControls`
 * (role, accessible name, shown or hidden, in page order). Every top navigation section on /dev/parity,
 * and the HR (/hr) and employee (/start) bars of the no-backend run. Nothing on them may change with this card.
 */
export const DEVELOP_SHA = '06201c3';

export const PARITY_BARS: Record<'desktop-1280' | 'phone-390', Record<string, string[][]>> = {
  "desktop-1280": {
    "top-navigation|Desktop": [
      [
        "button:Open menu:hidden",
        "a:Naleko People home:hidden",
        "input:Search people and documents:shown",
        "button:Search:hidden",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "top-navigation|Phone (compact)": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "top-navigation|Notifications open": [
      [
        "button:Open menu:hidden",
        "a:Naleko People home:hidden",
        "input:Search people and documents:shown",
        "button:Search:hidden",
        "button:Notifications, 3 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Desktop: banner, sidebar, top bar, main and flags": [
      [
        "button:Open menu:hidden",
        "button:Collapse menu:shown",
        "a:Naleko People home:hidden",
        "input:Search people and documents:shown",
        "button:Search:hidden",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Desktop with the sidebar collapsed (64px)": [
      [
        "button:Open menu:hidden",
        "button:Expand menu:shown",
        "a:Naleko People home:hidden",
        "input:Search people and documents:shown",
        "button:Search:hidden",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Admin: the same frame, an item in the Admin section selected": [
      [
        "button:Open menu:hidden",
        "button:Collapse menu:shown",
        "a:Naleko People home:hidden",
        "input:Search people and documents:shown",
        "button:Search:hidden",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Phone: top bar, page and bottom action bar": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 2 unread:shown",
        "button:Your account, Tariro Moyo:shown"
      ]
    ],
    "app-shell|Phone: the sidebar open as a drawer": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 2 unread:shown",
        "button:Your account, Tariro Moyo:shown"
      ]
    ]
  },
  "phone-390": {
    "top-navigation|Desktop": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "top-navigation|Phone (compact)": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "top-navigation|Notifications open": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 3 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Desktop: banner, sidebar, top bar, main and flags": [
      [
        "button:Open menu:shown",
        "button:Collapse menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Desktop with the sidebar collapsed (64px)": [
      [
        "button:Open menu:shown",
        "button:Expand menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Admin: the same frame, an item in the Admin section selected": [
      [
        "button:Open menu:shown",
        "button:Collapse menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 4 unread:shown",
        "button:Your account, Thandeka Dlamini:shown"
      ]
    ],
    "app-shell|Phone: top bar, page and bottom action bar": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 2 unread:shown",
        "button:Your account, Tariro Moyo:shown"
      ]
    ],
    "app-shell|Phone: the sidebar open as a drawer": [
      [
        "button:Open menu:shown",
        "a:Naleko People home:shown",
        "input:Search people and documents:hidden",
        "button:Search:shown",
        "button:Notifications, 2 unread:shown",
        "button:Your account, Tariro Moyo:shown"
      ]
    ]
  }
};

export const HR_BAR: Record<'desktop-1280' | 'phone-390', string[]> = {
  "desktop-1280": [
    "button:Open menu:hidden",
    "button:Modules:shown",
    "a:Naleko People home:hidden",
    "input:Search people and documents:shown",
    "button:Ask Batsi:shown",
    "button:Search:hidden",
    "button:Notifications:shown",
    "button:Your account, Jane Smith:shown"
  ],
  "phone-390": [
    "button:Open menu:shown",
    "button:Modules:shown",
    "a:Naleko People home:shown",
    "input:Search people and documents:hidden",
    "button:Ask Batsi:shown",
    "button:Search:shown",
    "button:Notifications:shown",
    "button:Your account, Jane Smith:shown"
  ]
};

export const EMPLOYEE_BAR: Record<'desktop-1280' | 'phone-390', string[]> = {
  "desktop-1280": [
    "button:Open menu:hidden",
    "button:Modules:shown",
    "a:Naleko People home:hidden",
    "input:Search people and documents:shown",
    "button:Search:hidden",
    "button:Notifications:shown",
    "button:Your account, John Doe:shown"
  ],
  "phone-390": [
    "button:Open menu:shown",
    "button:Modules:shown",
    "a:Naleko People home:shown",
    "input:Search people and documents:hidden",
    "button:Search:shown",
    "button:Notifications:shown",
    "button:Your account, John Doe:shown"
  ]
};
