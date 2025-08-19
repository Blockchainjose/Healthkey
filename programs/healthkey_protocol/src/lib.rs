use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("2aPJ91YqkdpSTucNwBxGa42uwoHUCdhx6A4qeBkBrNkJ");

#[program]
pub mod healthkey_protocol {
    use super::*;

    pub fn initialize_user_profile(
        ctx: Context<InitializeUserProfile>,
        arweave_hash: String,
        goal: String,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.user_profile;
        profile.authority = *ctx.accounts.authority.key;
        profile.arweave_hash = arweave_hash;
        profile.goal = goal;
        profile.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Transfer $HEALTH from the PDA-owned vault token account to the user's ATA.
    /// Automatically creates the user's ATA if it doesn't exist.
    pub fn reward_user(ctx: Context<RewardUser>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        msg!("Vault PDA: {}", ctx.accounts.vault_authority.key());"init_if_needed"

        // PDA signer seeds for the vault authority
        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[u8]] = &[b"vault", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        // Transfer from vault -> user ATA
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();

        token::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeUserProfile<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 4 + 100 + 4 + 100 + 8,
        seeds = [b"user_profile", authority.key().as_ref()],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RewardUser<'info> {
    // 1) PDA authority first
    #[account(
        seeds = [b"vault"],
        bump,
    )]
    /// CHECK: PDA signer — verified by seeds
    pub vault_authority: UncheckedAccount<'info>,

    // 2) Mint before any ATAs that reference it
    pub mint: Account<'info, Mint>,

    // 3) Payer/signers before accounts that reference them
    #[account(mut)]
    pub user: Signer<'info>,

    // 4) User ATA can reference `user` and `mint` (both are above now)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    // 5) Vault ATA can reference `vault_authority` and `mint` (both are above)
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    // Programs needed for ATA creation / CPI
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct UserProfile {
    pub authority: Pubkey,
    pub arweave_hash: String,
    pub goal: String,
    pub created_at: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
}
