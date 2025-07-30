use anchor_lang::prelude::*;
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

    pub fn reward_user(ctx: Context<RewardUser>, amount: u64) -> Result<()> {
        msg!("Vault PDA: {}", ctx.accounts.vault_authority.key());

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.clone(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let vault_seeds: &[&[u8]] = &[
        b"vault",
        &[ctx.bumps.vault_authority],
];
         let signer: &[&[&[u8]]] = &[vault_seeds];


 
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
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    /// CHECK: PDA signer — manually verified
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// The user who is being rewarded
    #[account(mut)]
    pub user: Signer<'info>,

    /// The token mint for $HEALTH
    pub mint: Account<'info, Mint>,

    /// SPL token program
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct UserProfile {
    pub authority: Pubkey,
    pub arweave_hash: String,
    pub goal: String,
    pub created_at: i64,
}
