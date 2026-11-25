ALTER TABLE credit_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'welcome'));

ALTER TABLE credit_holds ADD COLUMN funding TEXT NOT NULL DEFAULT 'paid' CHECK (funding IN ('paid', 'welcome'));
