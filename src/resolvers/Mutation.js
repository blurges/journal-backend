const { 
  AuthenticationError,
  UserInputError
} = require('apollo-server');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');

const Mutations = {
  async createEntry(parent, args, ctx, info) {
    if (!ctx.request.userId) {
      throw new AuthenticationError('You are not logged in');
    }

    const hashed = await bcrypt.hash

    const entry = await ctx.db.mutation.createEntry(
      {
        data: {
          user: {
            connect: {
              id: ctx.request.userId,
            },
          },
          ...args,
        },
      },
      info
    );

    return entry;
  },
  async updateEntry(parent, args, ctx, info) {
    // first take a copy of the updates
    console.log('This should be white-listed')
    const updates = { ...args };
    // remove the ID from the updates
    delete updates.id;
    // run the update method

    const hashed = await bcrypt.hash

    return ctx.db.mutation.updateEntry(
      {
        data: updates,
        where: {
          id: args.id,
        },
      },
      info
    );
  },
  async deleteEntry(parent, args, ctx, info) {
    const where = { id: args.id };
    const entry = await ctx.db.query.entry({ where }, `{ id title user { id }}`);
    const ownsItem = entry.user.id === ctx.request.userId;

    if (!ownsItem) {
      throw new AuthenticationError("You don't have permission to do that!");
    }

    return ctx.db.mutation.deleteEntry({ where }, info);
  },
  async signup(parent, args, ctx, info) {
    // lowercase their email
    args.email = args.email.toLowerCase();
    // hash their password
    const password = await bcrypt.hash(args.password, 10);
    // create the user in the database
    const user = await ctx.db.mutation.createUser(
      {
        data: {
          ...args,
          password,
        },
      },
      info
    );
    // create the JWT token for them
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    ctx.response.set({
      'Access-Control-Expose-Headers': 'token',
      'token': token
    });
    // Finalllllly we return the user to the browser
    return user;
  },
  async signin(parent, { email, password }, ctx, info) {
    // 1. check if there is a user with that email
    const user = await ctx.db.query.user({ where: { email } });
    if (!user) {
      throw new AuthenticationError(`No account found for ${email}. Sign up! :)`);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new AuthenticationError('That did not work.');
    }
    // 3. generate the JWT Token
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    ctx.response.set({
      'Access-Control-Expose-Headers': 'token',
      'token': token
    });
    // 5. Return the user
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, args, ctx, info) {
    // 1. Check if this is a real user
    const user = await ctx.db.query.user({ where: { email: args.email } });
    if (!user) {
      throw new AuthenticationError(`No account found for ${email}. Sign up! :)`);
    }
    // 2. Set a reset token and expiry on that user
    const randomBytesPromiseified = promisify(randomBytes);
    const resetToken = (await randomBytesPromiseified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email: args.email },
      data: { resetToken, resetTokenExpiry },
    });
    // 3. Email them that reset token
    const mailRes = await transport.sendMail({
      from: process.env.NOREPLY,
      to: user.email,
      subject: 'Your Password Reset Token',
      html: makeANiceEmail(`Your Password Reset Token is here!
      \n\n
      <a href="${ctx.request.headers.origin}/reset-password/${resetToken}">Click Here to Reset</a>`),
    });

    // 4. Return the message
    return { message: 'Thanks!' };
  },
  async resetPassword(parent, args, ctx, info) {
    // 1. check if the passwords match
    if (args.password !== args.confirmPassword) {
      throw new UserInputError("The passwords don't match");
    }
    // 2. check if its a legit reset token
    // 3. Check if its expired
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000,
      },
    });
    if (!user) {
      throw new UserInputError('This token is either invalid or expired');
    }
    // 4. Hash their new password
    const password = await bcrypt.hash(args.password, 10);
    // 5. Save the new password to the user and remove old resetToken fields
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email },
      data: {
        password,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    // 6. Generate JWT
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    ctx.response.set({
      'Access-Control-Expose-Headers': 'token',
      'token': token
    });
    // 8. return the new user
    return updatedUser;
  }
};

module.exports = Mutations;
